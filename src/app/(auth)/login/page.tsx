import type { Metadata } from "next";
import { AuthScreen } from "../auth-screen";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage() {
  return <AuthScreen initial="login" />;
}
