# Teste de autenticacao no staging

O staging nao deve conter uma senha fixa no codigo ou no repositorio. Para
criar um usuario de teste:

1. Configure `DATABASE_URL` e `AUTH_SECRET` no App Service de staging como
   Application settings.
2. Abra `/cadastro` no dominio do staging.
3. Crie um usuario com uma senha temporaria de pelo menos 10 caracteres.
4. Teste login em `/login`.
5. Teste logout pelo botao `Sair`.
6. Confirme que `/api/v1/me` retorna `401` depois do logout.
7. Remova a conta de teste e troque qualquer segredo temporario depois da
   validacao.

Nao use credenciais de producao no staging e nao registre a senha em issues,
commits, screenshots ou documentacao versionada.
