"use client";

import React from "react";
import CodeServerIDE from "./CodeServerIDE";

export default function VisualStage() {
  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <CodeServerIDE />
    </div>
  );
}
