import { useState, useEffect } from "react"

export const useIsMobile = (breakpoint = 900) => {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return
    
    // Set initial value
    setIsMobile(window.innerWidth <= breakpoint)
    
    // Update on resize
    const onResize = () => setIsMobile(window.innerWidth <= breakpoint)
    window.addEventListener("resize", onResize)
    
    return () => window.removeEventListener("resize", onResize)
  }, [breakpoint])

  return isMobile
}
