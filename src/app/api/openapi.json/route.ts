import { NextResponse } from "next/server";

const errorSchema = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: {
        code: { type: "string" },
        message: { type: "string" },
      },
      required: ["code", "message"],
    },
  },
};

const document = {
  openapi: "3.0.3",
  info: {
    title: "GiroFin API",
    version: "1.1.0",
    description: "API de identidade e dados financeiros para web e mobile.",
  },
  servers: [{ url: "/api/v1" }],
  tags: [{ name: "Auth", description: "Cadastro, login e sessoes" }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "opaque" },
      cookieAuth: { type: "apiKey", in: "cookie", name: "__Host-finance_session" },
    },
    schemas: {
      Error: errorSchema,
      LoginInput: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 1 },
          client: { type: "string", enum: ["web", "mobile"], default: "web" },
        },
      },
      RefreshInput: { type: "object", required: ["refreshToken"], properties: { refreshToken: { type: "string" } } },
    },
  },
  paths: {
    "/auth/register": {
      post: {
        tags: ["Auth"], summary: "Cria uma conta",
        requestBody: { required: true, content: { "application/json": { schema: { allOf: [{ "$ref": "#/components/schemas/LoginInput" }, { type: "object", required: ["name"], properties: { name: { type: "string", minLength: 2 } } }] } } } },
        responses: { "201": { description: "Conta criada" }, "400": { description: "Dados invalidos", content: { "application/json": { schema: { "$ref": "#/components/schemas/Error" } } } } },
      },
    },
    "/auth/login": {
      post: {
        tags: ["Auth"], summary: "Inicia uma sessao web ou mobile",
        requestBody: { required: true, content: { "application/json": { schema: { "$ref": "#/components/schemas/LoginInput" } } } },
        responses: { "200": { description: "Sessao criada; mobile recebe accessToken e refreshToken" }, "400": { description: "Entrada invalida" }, "401": { description: "Credenciais invalidas" } },
      },
    },
    "/auth/refresh": {
      post: {
        tags: ["Auth"], summary: "Rotaciona o refresh token mobile",
        requestBody: { required: true, content: { "application/json": { schema: { "$ref": "#/components/schemas/RefreshInput" } } } },
        responses: { "200": { description: "Tokens renovados" }, "401": { description: "Refresh token invalido ou reutilizado" } },
      },
    },
    "/auth/logout": {
      post: {
        tags: ["Auth"], summary: "Encerra e revoga a sessao",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        requestBody: { content: { "application/json": { schema: { "$ref": "#/components/schemas/RefreshInput" } } } },
        responses: { "200": { description: "Sessao encerrada" } },
      },
    },
    "/auth/forgot-password": { post: { tags: ["Auth"], summary: "Solicita recuperacao de senha", responses: { "200": { description: "Resposta anti-enumeracao" } } } },
    "/auth/reset-password": { post: { tags: ["Auth"], summary: "Define nova senha", responses: { "200": { description: "Senha redefinida" }, "400": { description: "Token invalido" } } } },
    "/me": { get: { tags: ["Auth"], summary: "Retorna o usuario autenticado", security: [{ cookieAuth: [] }, { bearerAuth: [] }], responses: { "200": { description: "Usuario atual" }, "401": { description: "Nao autenticado" } } } },
  },
};

export function GET() {
  return NextResponse.json(document);
}
