import type { APIRoute } from "astro";
import { PAGES, blogCards, htmlResponse } from "../lib/tegawari";

export const GET: APIRoute = async ({ url }) =>
	htmlResponse(PAGES.index.replace("{{CARDS}}", await blogCards("home")), 200, url.hostname);
