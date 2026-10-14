import AuthPage from "@/components/auth-page";

export default function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  return <AuthPage mode="signin" searchParams={searchParams} />;
}
