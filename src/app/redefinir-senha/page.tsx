import { AuthForm } from "@/components/auth-form";

export default async function RedefinirSenhaPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  return <AuthForm mode="reset" token={params.token ?? ""} />;
}
