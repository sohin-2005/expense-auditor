import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import { isSupabaseConfigured, missingSupabaseEnv } from './supabase'

const shell = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px',
  background: '#ffffff',
  color: '#111827',
  fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
}

const card = {
  maxWidth: 620,
  width: '100%',
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: 14,
  padding: '28px 30px',
  lineHeight: 1.6,
}

const code = {
  background: '#f6f7f9',
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  padding: '2px 7px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 13,
  color: '#4d7a00',
}

function SetupNotice() {
  return (
    <div style={shell}>
      <div style={card}>
        <h1 style={{ fontSize: 20, margin: '0 0 6px', fontWeight: 600 }}>Audixa isn't configured</h1>
        <p style={{ color: '#4b5563', margin: '0 0 18px', fontSize: 14 }}>
          The app built and loaded, but these environment variables are missing:
        </p>
        <ul style={{ margin: '0 0 18px', paddingLeft: 20 }}>
          {missingSupabaseEnv.map(name => (
            <li key={name} style={{ marginBottom: 6 }}><span style={code}>{name}</span></li>
          ))}
        </ul>
        <p style={{ color: '#4b5563', margin: 0, fontSize: 14 }}>
          Add them in <strong style={{ color: '#111827' }}>Vercel → Project → Settings → Environment
          Variables</strong> (also set <span style={code}>VITE_API_URL</span> to your backend URL),
          then <strong style={{ color: '#111827' }}>redeploy</strong>. Vite inlines these at build
          time, so a redeploy is required — restarting alone won't pick them up. Locally, put them in{' '}
          <span style={code}>frontend/.env</span>.
        </p>
      </div>
    </div>
  )
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Audixa crashed during render:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={shell}>
        <div style={card}>
          <h1 style={{ fontSize: 20, margin: '0 0 6px', fontWeight: 600 }}>Something broke while loading Audixa</h1>
          <p style={{ color: '#4b5563', margin: '0 0 16px', fontSize: 14 }}>
            The error below is also in your browser console.
          </p>
          <pre style={{
            ...code,
            display: 'block',
            padding: 14,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: '#ef4444',
            margin: '0 0 18px',
          }}>{String(this.state.error?.message || this.state.error)}</pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: '#76b900',
              color: '#ffffff',
              border: 'none',
              borderRadius: 8,
              padding: '9px 16px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isSupabaseConfigured ? <App /> : <SetupNotice />}
    </ErrorBoundary>
  </React.StrictMode>
)
