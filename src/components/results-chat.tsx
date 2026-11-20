"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import styles from "./results-chat.module.css";

type Message = { role: "user" | "assistant"; content: string };
const suggestions = ["¿Qué modelo lidera el ranking?", "¿Qué modelo es más rápido?", "¿Cuál destaca en seguridad?"];

export function ResultsChat({ isPrivate = false }: { isPrivate?: boolean }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const launcher = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const history = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  useEffect(() => {
    if (history.current) history.current.scrollTop = history.current.scrollHeight;
  }, [messages, pending, error]);

  function close() {
    setOpen(false);
    requestAnimationFrame(() => launcher.current?.focus());
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!question.trim() || pending) return;
    const next: Message[] = [...messages, { role: "user", content: question.trim() }];
    setPending(true);
    setQuestion("");
    setError("");
    try {
      const response = await fetch(isPrivate ? "/api/results-chat" : "/api/public/results-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next.slice(-9).map(message => ({ ...message, content: message.content.slice(0, 2400) }))),
      });
      const result = await response.json();
      if (!response.ok || typeof result.answer !== "string") {
        setError(result.error ?? "No pude obtener una respuesta.");
        setQuestion(question);
        return;
      }
      setMessages([...next, { role: "assistant", content: result.answer }]);
    } catch {
      setError("No pude conectar con el chat. Intenta de nuevo.");
      setQuestion(question);
    } finally {
      setPending(false);
    }
  }

  return (
    <aside className={styles.widget} aria-label="Chat de resultados">
      {open && (
        <section id="results-chat-panel" className={styles.panel} aria-label="Consultar resultados"
          onKeyDown={event => { if (event.key === "Escape") close(); }}>
          <header className={styles.header}>
            <div>
              <strong>Chat de resultados</strong>
              <div className={styles.caption}>{isPrivate ? "Leaderboard privado" : "Leaderboard público"}</div>
            </div>
            <button type="button" onClick={close} aria-label="Cerrar chat">×</button>
          </header>
          <div className={styles.history} ref={history} role="log" aria-live="polite">
            {!messages.length && suggestions.map(suggestion => (
              <button type="button" key={suggestion} onClick={() => {
                setQuestion(suggestion);
                input.current?.focus();
              }}>{suggestion}</button>
            ))}
            {messages.map((message, index) => (
              <p key={index} className={message.role === "user" ? styles.question : styles.answer}>{message.content}</p>
            ))}
            {pending && <p role="status">Consultando resultados…</p>}
            {error && <p role="alert">{error}</p>}
          </div>
          <form className={styles.form} onSubmit={submit}>
            <input ref={input} aria-label="Pregunta sobre los resultados" placeholder="Pregunta sobre el benchmark"
              value={question} onChange={event => setQuestion(event.target.value)} maxLength={2400} readOnly={pending} />
            <button type="submit" disabled={pending || !question.trim()}>Enviar</button>
          </form>
        </section>
      )}
      {!open && <button type="button" className={styles.launcher} ref={launcher} aria-expanded={open}
        onClick={() => setOpen(true)}>Preguntar al benchmark</button>}
    </aside>
  );
}
