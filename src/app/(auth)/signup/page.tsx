import type { Metadata } from "next";
import { AuthScreen } from "../auth-screen";

export const metadata: Metadata = { title: "Sign up" };

export default function SignupPage() {
  return <AuthScreen initial="signup" />;
}
