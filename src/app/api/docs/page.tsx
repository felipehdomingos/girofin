import { notFound } from "next/navigation";

import ApiDocsClient from "./api-docs-client";

export default function ApiDocsPage() {
  if (process.env.NODE_ENV === "production" || process.env.APP_ENV === "production") notFound();
  return <ApiDocsClient />;
}
