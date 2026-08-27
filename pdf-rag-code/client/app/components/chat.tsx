"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Doc {
  pageContent: string;
  metadata?: {
    source?: string;
    loc?: {
      pageNumber?: number;
    };
  };
}

interface IMessage {
  role: "user" | "assistant";
  content: string;
  documents?: Doc[];
}

export default function ChatComponent() {
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [messages, setMessages] = React.useState<IMessage[]>([]);

  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages]);

  async function sendMessage() {
    if (!input.trim() || loading) return;

    const question = input.trim();

    setInput("");
    setLoading(true);

    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: question,
      },
      {
        role: "assistant",
        content: "",
        documents: [],
      },
    ]);

    try {
      const response = await fetch("http://localhost:8000/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: question,
        }),
      });

      if (!response.body) {
        throw new Error("No response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let docsReceived = false;
      let docsBuffer = "";

      while (true) {
        const { value, done } = await reader.read();

        if (done) break;

        const chunk = decoder.decode(value, {
          stream: true,
        });

        // first chunk contains docs JSON
        if (!docsReceived) {
          docsBuffer += chunk;

          const splitIndex = docsBuffer.indexOf("\n__DOCS_END__\n");

          if (splitIndex === -1) continue;

          const docsJson = docsBuffer.slice(0, splitIndex);
          const remainingText = docsBuffer.slice(
            splitIndex + "\n__DOCS_END__\n".length,
          );

          const parsed = JSON.parse(docsJson);

          setMessages((prev) =>
            prev.map((msg, index) =>
              index === prev.length - 1
                ? {
                    ...msg,
                    documents: parsed.docs,
                    content: remainingText,
                  }
                : msg,
            ),
          );

          docsReceived = true;
          continue;
        }

        // append streamed text

        setMessages((prev) =>
          prev.map((msg, index) =>
            index === prev.length - 1
              ? {
                  ...msg,
                  content: msg.content + chunk,
                }
              : msg,
          ),
        );
      }
    } catch (err) {
      console.error(err);

      setMessages((prev) =>
        prev.map((msg, index) =>
          index === prev.length - 1
            ? {
                ...msg,
                content: "Something went wrong.",
              }
            : msg,
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex h-screen max-w-5xl flex-col">
      <div className="flex-1 space-y-6 overflow-y-auto p-6">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex ${
              message.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-[80%] rounded-xl p-4 ${
                message.role === "user" ? "bg-blue-600 text-white" : "bg-muted"
              }`}
            >
              <p className="whitespace-pre-wrap">{message.content}</p>

              {message.documents && message.documents.length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer font-medium">
                    Retrieved Chunks ({message.documents.length})
                  </summary>

                  <div className="mt-3 space-y-3">
                    {message.documents.map((doc, i) => (
                      <div key={i} className="rounded border p-3 text-sm">
                        <div className="mb-2 text-xs text-muted-foreground">
                          Page {doc.metadata?.loc?.pageNumber ?? "-"}
                        </div>

                        <p className="whitespace-pre-wrap">{doc.pageContent}</p>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="animate-pulse text-sm text-muted-foreground">
            Gemini is typing...
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="border-t p-4">
        <div className="flex gap-3">
          <Input
            value={input}
            placeholder="Ask something about your PDF..."
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                sendMessage();
              }
            }}
          />

          <Button onClick={sendMessage} disabled={loading || !input.trim()}>
            {loading ? "Streaming..." : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}
