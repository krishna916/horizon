import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const workspaceRoot = path.resolve(__dirname, '../../../../');
const docsAiDir = path.join(workspaceRoot, 'docs/ai');
const indexPath = path.join(docsAiDir, 'INDEX.md');

// Metadata dictionary for standard files to maintain high-quality descriptions and audiences
const standardMeta = {
  'HORIZON_DECISION_SUMMARY.md': {
    audience: '**Primary LLM Context** / Everyone',
    type: 'Context & Decision Log',
    purpose: 'Ultra-compressed summary of all product, architectural, security, API, database, and engineering decisions. **Start here first.**'
  },
  'ARCHITECTURE_OVERVIEW.md': {
    audience: 'Developers & Architects',
    type: 'Architecture Spec',
    purpose: 'High-level system structure, tech stack, modular monolith overview, and core database design.'
  },
  'HORIZON_ARCHITECTURE_CONTEXT.md': {
    audience: '**LLM Context** / Architects',
    type: 'Architectural Memory',
    purpose: 'Compressed context log optimized for AI code understanding, mapping domain aggregates, security, and persistence models.'
  },
  'HORIZON_PRODUCT_CONTEXT.md': {
    audience: '**LLM Context** / Product Owners',
    type: 'Product Memory',
    purpose: 'Core V1 product scope, information architecture, shared concepts (Capture, Inbox, Tags, Archive, Trash), and navigation patterns.'
  },
  'HORIZON_ENGINEERING_CONTEXT.md': {
    audience: '**LLM Context** / Developers',
    type: 'Engineering Memory',
    purpose: 'Coding standards, package structures, query strategy levels, API standards, and testing/logging philosophy.'
  },
  'ENG-001 Engineering Guidelines v1.0.md': {
    audience: 'Backend Developers',
    type: 'Standards Guide',
    purpose: 'Authoritative Java/Spring Boot conventions, transaction boundaries, validation layers, testing rules, and AI escalation triggers.'
  },
  'ENG-002 - Frontend Engineering Guide.md': {
    audience: 'Frontend Developers',
    type: 'Living Guide',
    purpose: 'Frontend-specific conventions (React 19, Vite, TanStack Router/Query, feature-based module layouts, and naming rules).'
  }
};

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/&/g, '') // remove & leaving surrounding spaces
    .replace(/[^\w\s-]/g, '') // remove special chars except words, spaces, hyphens
    .trim()
    .replace(/[\s_]+/g, '-') // replace spaces/underscores with hyphens
    .replace(/-+/g, '-'); // collapse consecutive hyphens
}

function extractPurpose(content) {
  // Try matching bold Purpose: format
  const purposeRegex = /(?:\*\*Purpose:\*\*|\*Purpose:\*|Purpose:)\s*(.*)/i;
  const match = content.match(purposeRegex);
  if (match && match[1].trim()) {
    return match[1].trim();
  }

  // Fallback: search for first non-empty, non-header, non-blockquote, non-table line
  const lines = content.split('\n');
  for (let line of lines) {
    line = line.trim();
    if (line && !line.startsWith('#') && !line.startsWith('>') && !line.startsWith('|') && !line.startsWith('---')) {
      // Ignore document fields table lines
      if (line.includes('|')) continue;
      // Strip markdown bold/italic
      return line.replace(/[\*\#\_]/g, '').trim();
    }
  }
  return 'No description available.';
}

function generateIndex() {
  console.log(`Scanning documentation directory: ${docsAiDir}`);
  
  if (!fs.existsSync(docsAiDir)) {
    console.error(`Error: Directory does not exist at ${docsAiDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(docsAiDir)
    .filter(file => file.endsWith('.md') && file !== 'INDEX.md' && file !== 'README.md');

  // Sort files: standard files first in order, then others alphabetically
  const standardOrder = Object.keys(standardMeta);
  files.sort((a, b) => {
    const idxA = standardOrder.indexOf(a);
    const idxB = standardOrder.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });

  const parsedDocs = files.map(file => {
    const filePath = path.join(docsAiDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // Parse first H1 title
    const h1Match = content.match(/^#\s+(.*)/m);
    const title = h1Match ? h1Match[1].trim() : file.replace('.md', '');
    
    // Extract purpose/abstract
    const purpose = standardMeta[file] ? standardMeta[file].purpose : extractPurpose(content);
    const audience = standardMeta[file] ? standardMeta[file].audience : 'Developers';
    const type = standardMeta[file] ? standardMeta[file].type : 'Documentation';

    // Parse H2 headings for deep links
    const lines = content.split('\n');
    const sections = [];
    let inCodeBlock = false;
    for (const line of lines) {
      if (line.trim().startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock) continue;

      const h2Match = line.match(/^##\s+(.*)/);
      if (h2Match) {
        const rawHeading = h2Match[1].trim();
        // Skip common structural headings like "Change Log" or metadata lists if appropriate, but keep them for full mapping
        const heading = rawHeading.replace(/[\*\_\`]/g, '');
        const slug = slugify(rawHeading);
        sections.push({ heading, slug });
      }
    }

    return { file, title, purpose, audience, type, sections };
  });

  // Reconstruct INDEX.md content
  let indexContent = `# Horizon AI Documentation Index Map

Welcome to the Horizon AI Documentation directory. This index map provides a single entry point for AI agents and developers to quickly locate and navigate to specific topics, context, and engineering standards without parsing every document sequentially.

---

## 1. Quick Reference Map

| File Name | Target Audience / Scope | Document Type | Core Purpose |
| :--- | :--- | :--- | :--- |
`;

  parsedDocs.forEach(doc => {
    const encodedFile = encodeURIComponent(doc.file);
    indexContent += `| [${doc.file}](./${encodedFile}) | ${doc.audience} | ${doc.type} | ${doc.purpose} |\n`;
  });

  indexContent += `
---

## 2. Detailed Document Outlines & Deep Links

Use the anchor links below to jump directly to specific sections within the files.
`;

  parsedDocs.forEach(doc => {
    const encodedFile = encodeURIComponent(doc.file);
    indexContent += `\n### 📂 [${doc.file}](./${encodedFile})\n`;
    indexContent += `*${doc.purpose.replace(/\*\*|__/g, '')}*\n`;
    
    if (doc.sections.length > 0) {
      doc.sections.forEach(sec => {
        indexContent += `* [${sec.heading}](./${encodedFile}#${sec.slug})\n`;
      });
    } else {
      indexContent += `*(No H2 sections defined)*\n`;
    }
    indexContent += `\n---`;
  });

  // Remove final extra horizontal line
  if (indexContent.endsWith('\n---')) {
    indexContent = indexContent.slice(0, -4);
  }

  fs.writeFileSync(indexPath, indexContent, 'utf-8');
  console.log(`Successfully generated documentation index at: ${indexPath}`);
}

generateIndex();
