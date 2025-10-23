"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function Page() {
  const router = useRouter()

  useEffect(() => {
    // Redirecionar para login se não autenticado, senão para dashboard
    const sessionData = localStorage.getItem("auth_session") || sessionStorage.getItem("auth_session")

    if (sessionData) {
      router.push("/dashboard")
    } else {
      router.push("/login")
    }
  }, [router])

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground">Redirecionando...</p>
    </div>
  )
}
