import { NextResponse } from "next/server";

const document = {
  openapi: "3.0.3",
  info: {
    title: "GranaFlow API",
    version: "1.0.0",
    description: "API de identidade e dados financeiros do GranaFlow.",
  },
  servers: [{ url: "/api/v1" }],
  tags: [{ name: "Auth", description: "Cadastro e sessões" }],
  paths: {
    "/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Cria uma conta",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "email", "password"],
                properties: {
                  name: { type: "string", minLength: 2 },
                  email: { type: "string", format: "email" },
                  password: { type: "string", minLength: 10 },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Conta criada" }, "400": { description: "Dados inválidos" } },
      },
    },
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Inicia uma sessão",
        responses: {
          "200": { description: "Sessão criada em cookie HttpOnly" },
          "401": { description: "Credenciais inválidas" },
        },
      },
    },
    "/auth/logout": {
      post: {
        tags: ["Auth"],
        summary: "Encerra a sessão",
        responses: { "200": { description: "Sessão encerrada" } },
      },
    },
    "/auth/forgot-password": {
      post: {
        tags: ["Auth"],
        summary: "Solicita recuperação de senha",
        responses: { "200": { description: "Resposta genérica anti-enumeração" } },
      },
    },
    "/auth/reset-password": {
      post: {
        tags: ["Auth"],
        summary: "Define uma nova senha",
        responses: { "200": { description: "Senha redefinida" }, "400": { description: "Token inválido" } },
      },
    },
    "/me": {
      get: {
        tags: ["Auth"],
        summary: "Retorna o usuário autenticado",
        responses: { "200": { description: "Usuário atual" }, "401": { description: "Não autenticado" } },
      },
    },
  },
};

export function GET() {
  return NextResponse.json(document);
}
