"use client"

import type React from "react"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"

export default function LoginPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<"login" | "signup">("login")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  // Login state
  const [loginEmail, setLoginEmail] = useState("")
  const [loginPassword, setLoginPassword] = useState("")
  const [rememberMe, setRememberMe] = useState(true)

  // Signup state
  const [signupEmail, setSignupEmail] = useState("")
  const [signupPassword, setSignupPassword] = useState("")
  const [signupRole, setSignupRole] = useState("")

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
        localStorage.setItem("edge.auth", JSON.stringify(session))
      } else {
        sessionStorage.setItem("edge.auth", JSON.stringify(session))
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
    alert("Cadastro não disponível nesta versão.")
  }

  return (
    <div className="login">
      <main className="auth">
        {/* Coluna Esquerda */}
        <section className="auth__left">
          <div className="auth__card">
            {/* Título */}
            <header className="brand">
              <h1 className="brand__title">Sistema de automação de PC</h1>
              <Image src="/assets/badge.jpg" alt="" width={60} height={60} className="brand__badge" priority />
            </header>

            {/* Tabs */}
            <div className="auth-tabs" role="tablist" aria-label="Acesso">
              <button
                className={`auth-tab ${activeTab === "login" ? "is-active" : ""}`}
                data-tab="login"
                role="tab"
                aria-selected={activeTab === "login"}
                onClick={() => setActiveTab("login")}
                type="button"
              >
                Log in
              </button>
              <button
                className={`auth-tab ${activeTab === "signup" ? "is-active" : ""}`}
                data-tab="signup"
                role="tab"
                aria-selected={activeTab === "signup"}
                onClick={() => setActiveTab("signup")}
                type="button"
              >
                Sign up
              </button>
            </div>

            {/* LOGIN */}
            {activeTab === "login" && (
              <form id="loginForm" className="auth-pane is-active" data-pane="login" onSubmit={handleLogin} noValidate>
                <label className="field">
                  <span className="field__label">Email</span>
                  <input
                    id="email"
                    type="email"
                    name="email"
                    autoComplete="username"
                    required
                    className="input"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                  />
                </label>

                <label className="field">
                  <span className="field__label">Senha</span>
                  <div className="input input--with-icon">
                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      name="senha"
                      autoComplete="current-password"
                      required
                      minLength={4}
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Mostrar/ocultar senha"
                      id="togglePwd"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      <svg viewBox="0 0 24 24" className="icon">
                        <path d="M12 5C7 5 3 9 2 12c1 3 5 7 10 7s9-4 10-7c-1-3-5-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z" />
                      </svg>
                    </button>
                  </div>
                </label>

                <label className="checkbox">
                  <input
                    type="checkbox"
                    name="remember"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  <span>Remember Me</span>
                </label>

                <button type="submit" className="btn btn--primary" disabled={loading}>
                  {loading ? "Entrando..." : "Log in"}
                </button>
                {error && (
                  <div id="loginError" className="muted tiny" style={{ color: "#b91c1c", marginTop: ".5rem" }}>
                    {error}
                  </div>
                )}
                <button
                  type="button"
                  className="btn btn--ghost"
                  id="forgotBtn"
                  onClick={() => alert("Recuperação de senha")}
                >
                  Esqueci minha senha
                </button>

                <div className="partners">
                  <Image src="/assets/edge.jpg" alt="edge" width={80} height={40} />
                  <Image src="/assets/vertex.jpg" alt="vertex" width={80} height={40} />
                </div>
              </form>
            )}

            {/* SIGN UP */}
            {activeTab === "signup" && (
              <form
                id="signupForm"
                className="auth-pane is-active"
                data-pane="signup"
                onSubmit={handleSignup}
                noValidate
              >
                <label className="field">
                  <span className="field__label">Email</span>
                  <input
                    type="email"
                    name="email"
                    required
                    className="input"
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                  />
                </label>

                <label className="field">
                  <span className="field__label">Senha</span>
                  <input
                    type="password"
                    name="senha"
                    required
                    minLength={4}
                    className="input"
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                  />
                </label>

                <label className="field">
                  <span className="field__label">Acesso</span>
                  <select
                    name="acesso"
                    required
                    className="input selectlike"
                    value={signupRole}
                    onChange={(e) => setSignupRole(e.target.value)}
                  >
                    <option value="" hidden>
                      Selecione…
                    </option>
                    <option value="ADMIN">Administrativo</option>
                    <option value="GERENTE">Gerente de Projeto</option>
                  </select>
                </label>

                <button type="submit" className="btn btn--primary">
                  Criar conta
                </button>
                <p className="muted tiny">Ao continuar, você concorda com os termos de uso.</p>
              </form>
            )}
          </div>
        </section>

        {/* Coluna Direita (imagem) */}
        <section className="auth__right" aria-hidden="true">
          <Image
            src="/assets/index.jpg"
            alt="Ilustração do sistema"
            width={800}
            height={1000}
            className="illustration-hero"
            priority
          />
        </section>
      </main>

      <style jsx global>{`
        .login {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }

        .auth {
          display: grid;
          grid-template-columns: 1fr 1fr;
          max-width: 1400px;
          width: 100%;
          min-height: 100vh;
          background: white;
        }

        .auth__left {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 3rem 2rem;
        }

        .auth__card {
          width: 100%;
          max-width: 420px;
        }

        .brand {
          text-align: center;
          margin-bottom: 2.5rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1rem;
        }

        .brand__title {
          font-family: "Hanken Grotesk", system-ui, sans-serif;
          font-size: 1.75rem;
          font-weight: 800;
          color: #1a202c;
          line-height: 1.2;
        }

        .brand__badge {
          width: 60px;
          height: 60px;
          object-fit: contain;
        }

        .auth-tabs {
          display: flex;
          gap: 0;
          margin-bottom: 2rem;
          border-bottom: 2px solid #e2e8f0;
        }

        .auth-tab {
          flex: 1;
          padding: 0.875rem 1rem;
          background: transparent;
          border: none;
          border-bottom: 3px solid transparent;
          color: #718096;
          font-weight: 500;
          font-size: 1rem;
          cursor: pointer;
          transition: all 0.2s;
          margin-bottom: -2px;
        }

        .auth-tab.is-active {
          border-bottom-color: #3b82f6;
          color: #3b82f6;
          font-weight: 600;
        }

        .auth-pane {
          display: none;
        }

        .auth-pane.is-active {
          display: block;
        }

        .field {
          display: block;
          margin-bottom: 1.25rem;
        }

        .field__label {
          display: block;
          margin-bottom: 0.5rem;
          font-size: 0.875rem;
          font-weight: 500;
          color: #4a5568;
        }

        .input {
          width: 100%;
          padding: 0.75rem;
          border: 1px solid #cbd5e0;
          border-radius: 6px;
          font-size: 1rem;
          outline: none;
          transition: border-color 0.2s;
          font-family: inherit;
        }

        .input:focus {
          border-color: #3b82f6;
        }

        .input--with-icon {
          position: relative;
          display: flex;
          align-items: center;
          border: 1px solid #cbd5e0;
          border-radius: 6px;
          padding: 0;
          transition: border-color 0.2s;
        }

        .input--with-icon:focus-within {
          border-color: #3b82f6;
        }

        .input--with-icon input {
          border: none;
          flex: 1;
        }

        .icon-btn {
          background: transparent;
          border: none;
          cursor: pointer;
          padding: 0.5rem;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #718096;
        }

        .icon {
          width: 20px;
          height: 20px;
          fill: currentColor;
        }

        .checkbox {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 1.5rem;
          cursor: pointer;
          font-size: 0.875rem;
          color: #4a5568;
        }

        .checkbox input {
          cursor: pointer;
        }

        .btn {
          width: 100%;
          padding: 0.875rem;
          border: none;
          border-radius: 6px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          font-family: inherit;
        }

        .btn--primary {
          background: #667eea;
          color: white;
          margin-bottom: 0.5rem;
        }

        .btn--primary:hover:not(:disabled) {
          background: #5a67d8;
        }

        .btn--primary:disabled {
          background: #a0aec0;
          cursor: not-allowed;
        }

        .btn--ghost {
          background: transparent;
          color: #667eea;
          font-weight: 500;
        }

        .btn--ghost:hover {
          background: #ebf4ff;
        }

        .muted {
          color: #718096;
        }

        .tiny {
          font-size: 0.75rem;
        }

        .partners {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 1.5rem;
          margin-top: 2rem;
          padding-top: 2rem;
          border-top: 1px solid #e2e8f0;
        }

        .partners img {
          height: 40px;
          width: auto;
          object-fit: contain;
        }

        .auth__right {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem;
          position: relative;
          overflow: hidden;
        }

        .illustration-hero {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .selectlike {
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23718096' d='M6 9L1 4h10z'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 0.75rem center;
          padding-right: 2.5rem;
        }

        @media (max-width: 1024px) {
          .auth {
            grid-template-columns: 1fr;
          }

          .auth__right {
            display: none;
          }
        }
      `}</style>
    </div>
  )
}
