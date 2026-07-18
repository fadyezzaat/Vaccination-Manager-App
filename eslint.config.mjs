export default [
  {
    files: ["**/*.jsx", "**/*.js", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
        ecmaVersion: 2022,
        sourceType: "module"
      },
      globals: {
        document: "readonly",
        window: "readonly",
        console: "readonly",
        Swal: "readonly",
        React: "readonly",
        ReactDOM: "readonly",
        GOOGLE_SCRIPT_URL: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        FileReader: "readonly",
        isNaN: "readonly"
      }
    },
    rules: {
      "no-undef": "error"
    }
  }
];
