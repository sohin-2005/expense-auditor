import uuid
from datetime import datetime
from fastapi import APIRouter, Body, Depends, HTTPException
from ai_provider import TEXT, call_ai_json
from config import TRIP_MAX_TOKENS
from db import db, insert_row, offload
from deps import Principal, get_current_user, get_principal, require_submitter
from domain.status import parse_limit_value
from domain.util import ensure_object, ensure_string_list
from services.audit import build_trip_planner_prompt
from services.policy import get_policy, get_policy_context

router = APIRouter()


@router.post("/trip-plans/generate")
async def generate_trip_plan(payload: dict = Body(...), principal: Principal = Depends(require_submitter)):
    destination = str(payload.get("destination") or "").strip()
    start_date = str(payload.get("start_date") or "").strip()
    end_date = str(payload.get("end_date") or "").strip()
    business_purpose = str(payload.get("business_purpose") or "").strip()
    # From the profile, not the body: a client-chosen company_id selects which
    # company's policy the plan is judged against.
    company_id = principal.company_id
    user = principal.user

    activities = payload.get("activities") or []
    if isinstance(activities, str):
        activities = [x.strip() for x in activities.split(",") if x.strip()]
    if not isinstance(activities, list):
        activities = []

    expensive_choices = payload.get("expensive_choices") or []
    if not isinstance(expensive_choices, list):
        expensive_choices = []

    if not destination or not start_date or not end_date or not business_purpose:
        raise HTTPException(
            status_code=400, detail="destination, start_date, end_date and business_purpose are required")

    policy_text = await offload(get_policy, company_id)
    trip_request = {
        "destination": destination,
        "start_date": start_date,
        "end_date": end_date,
        "business_purpose": business_purpose,
        "activities": activities,
        "expensive_choices": expensive_choices,
    }

    policy_context = get_policy_context(policy_text, {
        "destination": destination,
        "business_purpose": business_purpose,
        "activities": activities,
    })
    prompt = build_trip_planner_prompt(policy_context, trip_request)

    try:
        llm_json = await call_ai_json(
            messages=[{"role": "user", "content": prompt}],
            task=TEXT,
            max_tokens=TRIP_MAX_TOKENS,
            temperature=0.1,
        )
    except Exception:
        llm_json = {
            "transport_suggestions": [
                "Use economy class for flights and standard rail fare unless policy allows exceptions.",
                "Prefer policy-approved local transport vendors and keep itemized receipts.",
            ],
            "lodging_caps": {
                "summary": f"Use the city lodging cap for {destination}; if no city cap exists, choose a mid-range business hotel.",
                "max_per_night": None,
                "currency": None,
            },
            "food_per_diem": {
                "summary": "Apply standard daily meal/per diem limits and separate client entertainment spends.",
                "daily_limit": None,
                "client_entertainment_limit": None,
                "currency": None,
            },
            "compliance_risk_summary": [
                "Policy AI was temporarily unavailable, so this plan is generated in safe fallback mode.",
                "Premium/last-minute bookings may require stronger justification.",
            ],
            "compliance_score": 55,
            "contextual_justification_prompts": [
                "Add business urgency and approval context for any premium option.",
            ],
            "recommended_itinerary": [
                "Book refundable compliant travel options first.",
                "Capture receipts with clear business purpose tagging.",
            ],
        }

    transport_suggestions = ensure_string_list(
        llm_json.get("transport_suggestions"))
    compliance_risk_summary = ensure_string_list(
        llm_json.get("compliance_risk_summary"))
    contextual_prompts = ensure_string_list(
        llm_json.get("contextual_justification_prompts"))
    recommended_itinerary = ensure_string_list(
        llm_json.get("recommended_itinerary"))

    lodging_caps = ensure_object(llm_json.get("lodging_caps"))
    food_per_diem = ensure_object(llm_json.get("food_per_diem"))

    try:
        compliance_score = int(float(llm_json.get("compliance_score", 0)))
    except Exception:
        compliance_score = 0
    compliance_score = max(0, min(100, compliance_score))

    normalized_plan = {
        "transport_suggestions": transport_suggestions,
        "lodging_caps": {
            "summary": str(lodging_caps.get("summary") or "No specific lodging guidance found in policy."),
            "max_per_night": parse_limit_value(lodging_caps.get("max_per_night")),
            "currency": lodging_caps.get("currency") or None,
        },
        "food_per_diem": {
            "summary": str(food_per_diem.get("summary") or "No specific meal/per diem guidance found in policy."),
            "daily_limit": parse_limit_value(food_per_diem.get("daily_limit")),
            "client_entertainment_limit": parse_limit_value(food_per_diem.get("client_entertainment_limit")),
            "currency": food_per_diem.get("currency") or None,
        },
        "compliance_risk_summary": compliance_risk_summary,
        "compliance_score": compliance_score,
        "contextual_justification_prompts": contextual_prompts,
        "recommended_itinerary": recommended_itinerary,
    }

    plan_row = {
        "id": str(uuid.uuid4()),
        "employee_id": str(user.id),
        "company_id": company_id,
        "destination": destination,
        "start_date": start_date,
        "end_date": end_date,
        "business_purpose": business_purpose,
        "activities": activities,
        "expensive_choices": expensive_choices,
        "ai_plan": normalized_plan,
        "compliance_score": compliance_score,
        "created_at": datetime.utcnow().isoformat(),
    }

    saved_ok = True
    save_warning = None
    try:
        saved = await offload(insert_row, "travel_plans", plan_row, "Trip plan")
        saved_row = saved.data[0] if saved.data else plan_row
    except Exception as e:
        saved_ok = False
        save_warning = f"Trip plan generated but could not be saved. Ensure table 'travel_plans' exists. {str(e)}"
        saved_row = plan_row

    return {
        "plan": normalized_plan,
        "travel_plan": saved_row,
        "saved": saved_ok,
        "warning": save_warning,
    }


@router.get("/trip-plans/my")
def my_trip_plans(user=Depends(get_current_user)):
    try:
        res = (
            db().table("travel_plans")
            .select("*")
            .eq("employee_id", str(user.id))
            .order("created_at", desc=True)
            .execute()
        )
        return {"plans": res.data or []}
    except Exception:
        return {"plans": []}
