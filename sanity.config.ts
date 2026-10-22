import { defineConfig } from 'sanity';
import { structureTool } from 'sanity/structure';
import { schemaTypes } from './src/sanity/schemaTypes';

const projectId = process.env.PUBLIC_SANITY_PROJECT_ID || 'your-project-id';
const dataset = process.env.PUBLIC_SANITY_DATASET || 'production';

export default defineConfig({
  name: 'myipv4v6-studio',
  title: 'myipv4v6 Content Studio',
  projectId,
  dataset,
  basePath: '/studio',
  plugins: [structureTool()],
  schema: {
    types: schemaTypes,
  },
});
