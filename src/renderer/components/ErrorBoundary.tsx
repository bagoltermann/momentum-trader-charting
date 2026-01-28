import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  name?: string
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * Error boundary component to catch React rendering errors
 * and prevent the entire app from crashing.
 *
 * Usage:
 * <ErrorBoundary name="Chart">
 *   <EnhancedChart ... />
 * </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.name ? `:${this.props.name}` : ''}] Caught error:`, error)
    console.error('Component stack:', errorInfo.componentStack)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }
      return (
        <div style={{
          padding: '20px',
          background: 'rgba(255, 82, 82, 0.1)',
          border: '1px solid #FF5252',
          borderRadius: '4px',
          color: '#FF5252',
          textAlign: 'center'
        }}>
          <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>
            {this.props.name ? `${this.props.name} Error` : 'Something went wrong'}
          </div>
          <div style={{ fontSize: '12px', color: '#aaa' }}>
            {this.state.error?.message || 'Unknown error'}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              marginTop: '12px',
              padding: '8px 16px',
              background: '#FF5252',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Try Again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
