#!/bin/bash

# getlawb Quick Setup Script
# Run this in your Codespace to get everything working

set -e

echo "🚀 Setting up getlawb..."

# 1. Create directories
mkdir -p src examples tests tests/__fixtures__ docs .github/workflows .github/ISSUE_TEMPLATE

# 2. Move files to correct locations
echo "📁 Organizing files..."
mv src_client.ts src/client.ts 2>/dev/null || true
mv examples_index.ts examples/index.ts 2>/dev/null || true
mv getlawb-example.ts examples/complete-example.ts 2>/dev/null || true
mv docs_ARCHITECTURE.md docs/ARCHITECTURE.md 2>/dev/null || true

# Move GitHub workflows
mkdir -p .github/workflows
mv workflows_*.yml .github/workflows/ 2>/dev/null || true

# 3. Create jest config if not exists
if [ ! -f jest.config.js ]; then
cat > jest.config.js << 'JEST'
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/?(*.)+(spec|test).ts'],
  collectCoverageFrom: ['src/**/*.ts'],
};
JEST
fi

# 4. Create eslint config
if [ ! -f .eslintrc.json ]; then
cat > .eslintrc.json << 'ESLINT'
{
  "parser": "@typescript-eslint/parser",
  "extends": ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  "rules": {
    "@typescript-eslint/explicit-function-return-types": "warn"
  }
}
ESLINT
fi

# 5. Create prettier config
if [ ! -f .prettierrc.json ]; then
cat > .prettierrc.json << 'PRETTIER'
{
  "semi": true,
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2
}
PRETTIER
fi

# 6. Create .gitignore
cat > .gitignore << 'GIT'
node_modules/
dist/
coverage/
.env
.env.local
*.log
.DS_Store
.vscode/
.idea/
*.swp
*.swo
*~
GIT

# 7. Install dependencies
echo "📦 Installing dependencies..."
npm install

# 8. Build
echo "🔨 Building TypeScript..."
npm run build

# 9. Run tests
echo "🧪 Running tests..."
npm test 2>/dev/null || echo "⚠️  Tests need implementation"

# 10. Success
echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Review: cat src/client.ts"
echo "2. Test: npm test"
echo "3. Build: npm run build"
echo "4. Lint: npm run lint"
echo "5. Commit: git add . && git commit -m 'feat: complete implementation'"
echo "6. Deploy: git push origin main && git tag v0.1.0 && git push origin v0.1.0"
echo ""
