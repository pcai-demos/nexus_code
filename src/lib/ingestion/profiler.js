/**
 * Adaptive Structural Document Profiler
 * Analyzes document metrics (byte size, line count, format, structural density)
 * and returns domain-agnostic optimal RAG ingestion settings.
 */

function profileDocument(filePath, buffer) {
  const fileName = filePath.split('/').pop().toLowerCase();
  const fileExt = fileName.split('.').pop();
  const sizeBytes = buffer ? buffer.length : 0;
  const textContent = buffer ? buffer.toString('utf-8') : "";
  const lines = textContent.split('\n');
  const lineCount = lines.length;

  // Determine structural density type
  let structuralDensity = "Paragraph-Flow";
  if (['csv', 'tsv', 'xlsx'].includes(fileExt)) {
    structuralDensity = "Tabular-Records";
  } else if (['js', 'py', 'json', 'yaml', 'yml', 'ts', 'go', 'java', 'c', 'cpp'].includes(fileExt)) {
    structuralDensity = "Code-Blocks";
  } else if (lines.some(l => /^#+\s+/.test(l))) {
    structuralDensity = "Header-Hierarchy";
  }

  // Determine document scale tier
  let documentScale = "COMPACT";
  if (sizeBytes > 500000 || lineCount > 3000) {
    documentScale = "LARGE";
  } else if (sizeBytes > 50000 || lineCount > 350) {
    documentScale = "MEDIUM";
  }

  // Calculate recommended settings based on objective metrics
  let recommendedSettings = {
    chunkSize: 1500,
    chunkOverlap: 200,
    searchStrategy: "hybrid",
    maxContextChunks: 6,
    profileName: "Medium Structured Document",
    profileCode: "MEDIUM_STRUCTURED",
    description: "Balanced section-header chunking for mid-sized structured files."
  };

  if (structuralDensity === "Tabular-Records") {
    recommendedSettings = {
      chunkSize: 1000,
      chunkOverlap: 100,
      searchStrategy: "keyword",
      maxContextChunks: 8,
      profileName: "Tabular Data File",
      profileCode: "TABULAR_RECORDS",
      description: "Row-based record serialization for structured tabular datasets."
    };
  } else if (structuralDensity === "Code-Blocks") {
    recommendedSettings = {
      chunkSize: 1200,
      chunkOverlap: 150,
      searchStrategy: "hybrid",
      maxContextChunks: 4,
      profileName: "Source Code Workspace",
      profileCode: "CODE_WORKSPACE",
      description: "Function and block-preserving chunking for code and schemas."
    };
  } else if (documentScale === "COMPACT") {
    recommendedSettings = {
      chunkSize: 2000,
      chunkOverlap: 200,
      searchStrategy: "hybrid",
      maxContextChunks: 8,
      profileName: "Compact Document (< 50KB)",
      profileCode: "COMPACT_DOC",
      description: "Paragraph-preserving chunking with full context retention."
    };
  } else if (documentScale === "LARGE") {
    recommendedSettings = {
      chunkSize: 900,
      chunkOverlap: 200,
      searchStrategy: "hybrid",
      maxContextChunks: 8,
      profileName: "Large Multi-Section Document (> 500KB)",
      profileCode: "LARGE_DOC",
      description: "Granular clause-level chunking with hierarchical section indexing."
    };
  }

  return {
    metrics: {
      fileName,
      fileExt,
      sizeBytes,
      lineCount,
      structuralDensity,
      documentScale
    },
    recommendedSettings
  };
}

module.exports = {
  profileDocument
};
