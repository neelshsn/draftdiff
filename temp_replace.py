import pathlib

path = pathlib.Path('apps/frontend/src/components/draft/QuickPickRecommendations.tsx')
text = path.read_text(encoding='utf-8')
start = text.index('const RoleRecommendations')
end = text.index('const RecommendationDetailDialog')
block = 'const RoleColumns = () => null;\n'
text = text[:start] + block + text[end:]
path.write_text(text, encoding='utf-8')
