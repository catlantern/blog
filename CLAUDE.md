# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Vue 3 blog application built with Vite. The blog displays articles written in Markdown format, which are stored in the `public/articles` directory. The application uses Vue Router for navigation and Element Plus for UI components.

## Project Structure

- `src/` - Main source code
  - `views/` - Page components (Home, BlogPost, NotFound)
  - `router/` - Vue Router configuration
  - `utils/` - Utility functions for blog operations
  - `components/` - Reusable UI components (currently empty)
- `public/` - Static assets
  - `articles/` - Markdown articles and index.json metadata
- `src/App.vue` - Root application component
- `src/main.js` - Application entry point

## Development Commands

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build locally

## Code Architecture

### Blog Data Management
Articles are stored as Markdown files in `public/articles/` with metadata in `public/articles/index.json`. The `blogUtils.js` module handles:
- Fetching article list from index.json
- Loading individual articles by slug
- Rendering Markdown to HTML with syntax highlighting

### Routing
The application uses Vue Router with three routes:
- `/` - Home page showing article list with search and tag filtering
- `/post/:slug` - Individual blog post page
- `/:pathMatch(.*)*` - 404 Not Found page

### UI Components
- Element Plus for UI components (cards, buttons, pagination, etc.)
- Responsive design with mobile support
- Custom CSS styling for blog post content

## Key Implementation Details

1. Articles are loaded dynamically from static files rather than a database
2. Markdown rendering includes syntax highlighting for code blocks
3. Articles support tagging and date-based organization
4. Home page includes search functionality and tag filtering
5. Pagination is implemented for the article list