import obsidianmd from "eslint-plugin-obsidianmd";

export default [
	{
		ignores: ["main.js", "node_modules/**", "plugins/**", ".tmp_test/**"],
	},
	...obsidianmd.configs.recommended,
	{
		files: ["**/*.ts"],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			// 界面以中文为主，且 "Memos" 是品牌名、YYYY-MM-DD 是 moment 格式串，
			// 强制 sentence case 会把它们改成 memos / yyyy-mm-dd。
			"obsidianmd/ui/sentence-case": "off",
			// 规则建议的 Setting#setHeading(text) 需要 Obsidian 1.11+，
			// 本插件 minAppVersion 为 1.8.7，设置卡片标题继续用 h3/h4。
			"obsidianmd/settings-tab/no-manual-html-headings": "off",
		},
	},
];
