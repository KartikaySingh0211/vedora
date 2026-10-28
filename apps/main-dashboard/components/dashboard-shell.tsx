"use client";

import React from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./sidebar";
import UploadQueueSidebar from "./upload-queue-sidebar";

export default function DashboardShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isEmbed = pathname?.startsWith("/embed");

  if (isEmbed) {
    return (
      <main className="w-full h-screen bg-black overflow-hidden m-0 p-0">
        {children}
      </main>
    );
  }

  return (
    <div className="flex min-h-screen relative">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6 min-w-0 bg-white dark:bg-[#0A0C10] text-black dark:text-white">
        {children}
      </main>
      <UploadQueueSidebar />
    </div>
  );
}
