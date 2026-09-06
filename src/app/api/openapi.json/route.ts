import { NextResponse } from "next/server";

const document = {
  openapi: "3.0.3",
  info: {
    title: "GiroFin API",
    version: "1.0.0",
    description: "API de identidade e dados financeiros do GiroFin.",
  },
  servers: [{ url: "/api/v1" }],
  tags: [{ name: "Auth", description: "Cadastro e sess?es" }],
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
        responses: { "201": { description: "Conta criada" }, "400": { description: "Dados inv?lidos" }, "409": { description: "E-mail j? cadastrado" } },
      },
    },
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Inicia uma sess?o",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string", minLength: 1 },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Sess?o criada em cookie HttpOnly" },
          "400": { description: "Dados inv?lidos" },
          "401": { description: "Credenciais inv?lidas" },
        },
      },
    },
    "/auth/logout": {
      post: {
        tags: ["Auth"],
        summary: "Encerra a sess?o",
        responses: { "200": { description: "Sess?o encerrada" } },
      },
    },
    "/auth/forgot-password": {
      post: {
        tags: ["Auth"],
        summary: "Solicita recupera??o de senha",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email"],
                properties: {
                  email: { type: "string", format: "email" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Resposta gen?rica anti-enumera??o" },
          "400": { description: "E-mail inv?lido" },
        },
      },
    },
    "/auth/reset-password": {
      post: {
        tags: ["Auth"],
        summary: "Define uma nova senha",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["token", "password"],
                properties: {
                  token: { type: "string", minLength: 20 },
                  password: { type: "string", minLength: 10 },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Senha redefinida" },
          "400": { description: "Token inv?lido ou expirado" },
        },
      },
    },
    "/me": {
      get: {
        tags: ["Auth"],
        summary: "Retorna o usu?rio autenticado",
        responses: { "200": { description: "Usu?rio atual" }, "401": { description: "N?o autenticado" } },
      },
    },
  },
};

export function GET() {
  return NextResponse.json(document);
}
