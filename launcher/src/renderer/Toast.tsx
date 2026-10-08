import { useCallback, useEffect, useRef, useState } from 'react'

export function useToast() {
  const [message, setMessage] = useState<string>()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const show = useCallback((text: string) => {
    setMessage(text)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(undefined), 4000)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  return { message, show }
}

export function Toast(props: { message?: string }) {
  if (!props.message) return null
  return (
    <div className="toast" role="status">
      {props.message}
    </div>
  )
}
