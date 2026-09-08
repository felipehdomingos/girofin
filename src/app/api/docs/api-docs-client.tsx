"use client";

import { useEffect } from "react";

export default function ApiDocsClient() {
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js";
    script.onload = () => {
      const bundle = (window as unknown as { SwaggerUIBundle?: (options: Record<string, unknown>) => void }).SwaggerUIBundle;
      bundle?.({ url: "/api/openapi.json", dom_id: "#swagger-ui" });
    };
    document.body.appendChild(script);
    return () => script.remove();
  }, []);
  return <main className="min-h-dvh bg-white p-4 text-black"><link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" /><div id="swagger-ui" /></main>;
}
