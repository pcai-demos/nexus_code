import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";

export async function GET(request) {
  try {
    const rootPath = path.join(process.cwd(), "public", "demos", "demo_files");

    if (!fs.existsSync(rootPath)) {
      return NextResponse.json({ success: true, tree: [] });
    }

    // Recursive function to scan directory
    const scanDir = (dirPath) => {
      const items = fs.readdirSync(dirPath);
      const result = [];

      for (const item of items) {
        if (item.startsWith(".")) {
          continue; // skip hidden files and directories
        }

        const fullPath = path.join(dirPath, item);
        const stats = fs.statSync(fullPath);
        // Relative path starting from `/demos/demo_files` for static asset retrieval
        const relativePath = path.relative(path.join(process.cwd(), "public"), fullPath);

        if (stats.isDirectory()) {
          result.push({
            name: item,
            type: "directory",
            path: `/${relativePath.replace(/\\/g, "/")}`, // standardise path separators
            children: scanDir(fullPath),
          });
        } else {
          result.push({
            name: item,
            type: "file",
            path: `/${relativePath.replace(/\\/g, "/")}`,
            size: stats.size,
            extension: path.extname(item).toLowerCase(),
          });
        }
      }

      return result;
    };

    const tree = scanDir(rootPath);
    return NextResponse.json({ success: true, tree });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
