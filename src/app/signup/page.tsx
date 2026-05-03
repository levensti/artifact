import AuthPage from "@/components/auth-page";

export default function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  return <AuthPage mode="signup" searchParams={searchParams} />;
}
