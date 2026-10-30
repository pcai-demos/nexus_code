import { Poppins } from "next/font/google";
import "./globals.css";
import { UserProvider } from "@/context/UserContext";
import { NexusNavBar } from "@/nexus-core";

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata = {
  title: "NexCODE - AI Developer Platform",
  description: "Next.js AI Developer Platform for Nexus Global Industries (NGI), running locally on macOS.",
  icons: {
    icon: [
      {
        url: "/icon.svg?v=2",
        type: "image/svg+xml",
      },
    ],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en-GB" className="dark">
      <body className={`${poppins.variable} antialiased bg-black text-white`}>
        <UserProvider>
          <NexusNavBar />
          <main className="min-h-screen pt-20 bg-black text-white">
            {children}
          </main>
        </UserProvider>
      </body>
    </html>
  );
}
