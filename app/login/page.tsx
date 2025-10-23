"use client"

import type React from "react"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Eye, EyeOff } from "lucide-react"

export default function LoginPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<"login" | "signup">("login")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  // Login state
  const [loginEmail, setLoginEmail] = useState("")
  const [loginPassword, setLoginPassword] = useState("")
  const [rememberMe, setRememberMe] = useState(false)

  // Signup state
  const [signupEmail, setSignupEmail] = useState("")
  const [signupPassword, setSignupPassword] = useState("")
  const [signupRole, setSignupRole] = useState<"administrativo" | "gerente">("administrativo")

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Erro ao fazer login")
      }

      const session = await response.json()

      // Salvar sessão
      if (rememberMe) {
        localStorage.setItem("auth_session", JSON.stringify(session))
      } else {
        sessionStorage.setItem("auth_session", JSON.stringify(session))
      }

      router.push("/dashboard")
    } catch (err: any) {
      setError(err.message || "Erro ao fazer login")
    } finally {
      setLoading(false)
    }
  }

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    alert("Cadastro não disponível nesta versão. Use as credenciais de demonstração.")
  }

  const handleForgotPassword = () => {
    alert("Recuperação de senha")
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        padding: "1rem",
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: "12px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          width: "100%",
          maxWidth: "420px",
          padding: "2.5rem",
        }}
      >
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <h1
            style={{
              fontSize: "1.75rem",
              fontWeight: "700",
              color: "#1a202c",
              marginBottom: "0.5rem",
            }}
          >
            Sistema de automação de PC
          </h1>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            marginBottom: "2rem",
            borderBottom: "2px solid #e2e8f0",
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab("login")}
            className="auth-tab"
            data-tab="login"
            style={{
              flex: 1,
              padding: "0.75rem",
              background: "transparent",
              border: "none",
              borderBottom: activeTab === "login" ? "3px solid #667eea" : "3px solid transparent",
              color: activeTab === "login" ? "#667eea" : "#718096",
              fontWeight: activeTab === "login" ? "600" : "500",
              fontSize: "1rem",
              cursor: "pointer",
              transition: "all 0.2s",
              marginBottom: "-2px",
            }}
          >
            Log in
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("signup")}
            className="auth-tab"
            data-tab="signup"
            style={{
              flex: 1,
              padding: "0.75rem",
              background: "transparent",
              border: "none",
              borderBottom: activeTab === "signup" ? "3px solid #667eea" : "3px solid transparent",
              color: activeTab === "signup" ? "#667eea" : "#718096",
              fontWeight: activeTab === "signup" ? "600" : "500",
              fontSize: "1rem",
              cursor: "pointer",
              transition: "all 0.2s",
              marginBottom: "-2px",
            }}
          >
            Sign up
          </button>
        </div>

        {/* Login Form */}
        {activeTab === "login" && (
          <form onSubmit={handleLogin} className="auth-pane" data-pane="login">
            <div style={{ marginBottom: "1.25rem" }}>
              <label
                htmlFor="email"
                style={{
                  display: "block",
                  marginBottom: "0.5rem",
                  fontSize: "0.875rem",
                  fontWeight: "500",
                  color: "#4a5568",
                }}
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                placeholder="seu@email.com"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                required
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  border: "1px solid #cbd5e0",
                  borderRadius: "6px",
                  fontSize: "1rem",
                  outline: "none",
                  transition: "border-color 0.2s",
                }}
                onFocus={(e) => (e.target.style.borderColor = "#667eea")}
                onBlur={(e) => (e.target.style.borderColor = "#cbd5e0")}
              />
            </div>

            <div style={{ marginBottom: "1.25rem" }}>
              <label
                htmlFor="password"
                style={{
                  display: "block",
                  marginBottom: "0.5rem",
                  fontSize: "0.875rem",
                  fontWeight: "500",
                  color: "#4a5568",
                }}
              >
                Senha
              </label>
              <div style={{ position: "relative" }}>
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  required
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    paddingRight: "3rem",
                    border: "1px solid #cbd5e0",
                    borderRadius: "6px",
                    fontSize: "1rem",
                    outline: "none",
                    transition: "border-color 0.2s",
                  }}
                  onFocus={(e) => (e.target.style.borderColor = "#667eea")}
                  onBlur={(e) => (e.target.style.borderColor = "#cbd5e0")}
                />
                <button
                  type="button"
                  id="togglePwd"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: "absolute",
                    right: "0.75rem",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: "#718096",
                    padding: "0.25rem",
                  }}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div style={{ marginBottom: "1.5rem", display: "flex", alignItems: "center" }}>
              <input
                type="checkbox"
                id="remember"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                style={{ marginRight: "0.5rem", cursor: "pointer" }}
              />
              <label htmlFor="remember" style={{ fontSize: "0.875rem", color: "#4a5568", cursor: "pointer" }}>
                Remember Me
              </label>
            </div>

            {error && (
              <div
                style={{
                  marginBottom: "1rem",
                  padding: "0.75rem",
                  background: "#fed7d7",
                  color: "#c53030",
                  borderRadius: "6px",
                  fontSize: "0.875rem",
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                padding: "0.875rem",
                background: loading ? "#a0aec0" : "#667eea",
                color: "white",
                border: "none",
                borderRadius: "6px",
                fontSize: "1rem",
                fontWeight: "600",
                cursor: loading ? "not-allowed" : "pointer",
                transition: "background 0.2s",
                marginBottom: "1rem",
              }}
              onMouseEnter={(e) => !loading && (e.currentTarget.style.background = "#5a67d8")}
              onMouseLeave={(e) => !loading && (e.currentTarget.style.background = "#667eea")}
            >
              {loading ? "Entrando..." : "Log in"}
            </button>

            <button
              type="button"
              id="forgotBtn"
              onClick={handleForgotPassword}
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                color: "#667eea",
                fontSize: "0.875rem",
                cursor: "pointer",
                textAlign: "center",
                padding: "0.5rem",
              }}
            >
              Esqueci minha senha
            </button>

            <div
              style={{
                marginTop: "1.5rem",
                padding: "1rem",
                background: "#ebf4ff",
                borderRadius: "6px",
                fontSize: "0.875rem",
              }}
            >
              <p style={{ fontWeight: "600", marginBottom: "0.5rem", color: "#2c5282" }}>
                Credenciais de demonstração:
              </p>
              <p style={{ color: "#2d3748" }}>Email: admin@softex.com</p>
              <p style={{ color: "#2d3748" }}>Senha: qualquer senha com 6+ caracteres</p>
            </div>
          </form>
        )}

        {/* Signup Form */}
        {activeTab === "signup" && (
          <form onSubmit={handleSignup} className="auth-pane" data-pane="signup">
            <div style={{ marginBottom: "1.25rem" }}>
              <label
                htmlFor="signup-email"
                style={{
                  display: "block",
                  marginBottom: "0.5rem",
                  fontSize: "0.875rem",
                  fontWeight: "500",
                  color: "#4a5568",
                }}
              >
                Email
              </label>
              <input
                id="signup-email"
                type="email"
                placeholder="seu@email.com"
                value={signupEmail}
                onChange={(e) => setSignupEmail(e.target.value)}
                required
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  border: "1px solid #cbd5e0",
                  borderRadius: "6px",
                  fontSize: "1rem",
                  outline: "none",
                }}
                onFocus={(e) => (e.target.style.borderColor = "#667eea")}
                onBlur={(e) => (e.target.style.borderColor = "#cbd5e0")}
              />
            </div>

            <div style={{ marginBottom: "1.25rem" }}>
              <label
                htmlFor="signup-password"
                style={{
                  display: "block",
                  marginBottom: "0.5rem",
                  fontSize: "0.875rem",
                  fontWeight: "500",
                  color: "#4a5568",
                }}
              >
                Senha
              </label>
              <input
                id="signup-password"
                type="password"
                placeholder="••••••••"
                value={signupPassword}
                onChange={(e) => setSignupPassword(e.target.value)}
                required
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  border: "1px solid #cbd5e0",
                  borderRadius: "6px",
                  fontSize: "1rem",
                  outline: "none",
                }}
                onFocus={(e) => (e.target.style.borderColor = "#667eea")}
                onBlur={(e) => (e.target.style.borderColor = "#cbd5e0")}
              />
            </div>

            <div style={{ marginBottom: "1.5rem" }}>
              <label
                htmlFor="role"
                style={{
                  display: "block",
                  marginBottom: "0.5rem",
                  fontSize: "0.875rem",
                  fontWeight: "500",
                  color: "#4a5568",
                }}
              >
                Acesso
              </label>
              <select
                id="role"
                value={signupRole}
                onChange={(e) => setSignupRole(e.target.value as any)}
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  border: "1px solid #cbd5e0",
                  borderRadius: "6px",
                  fontSize: "1rem",
                  outline: "none",
                  cursor: "pointer",
                  background: "white",
                }}
                onFocus={(e) => (e.target.style.borderColor = "#667eea")}
                onBlur={(e) => (e.target.style.borderColor = "#cbd5e0")}
              >
                <option value="">Selecione…</option>
                <option value="administrativo">Administrativo</option>
                <option value="gerente">Gerente de Projeto</option>
              </select>
            </div>

            <button
              type="submit"
              style={{
                width: "100%",
                padding: "0.875rem",
                background: "#667eea",
                color: "white",
                border: "none",
                borderRadius: "6px",
                fontSize: "1rem",
                fontWeight: "600",
                cursor: "pointer",
                transition: "background 0.2s",
                marginBottom: "1rem",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#5a67d8")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#667eea")}
            >
              Criar conta
            </button>

            <p
              style={{
                textAlign: "center",
                fontSize: "0.75rem",
                color: "#718096",
                marginTop: "1rem",
              }}
            >
              Ao continuar, você concorda com os termos de uso.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
