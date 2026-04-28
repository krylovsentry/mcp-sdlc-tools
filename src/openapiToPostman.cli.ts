import { runOpenApiToPostman } from "./openapiToPostman";

runOpenApiToPostman().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
