import { authorizeAdmin } from "@/lib/admin-auth";
import { answerResultsChat } from "@/lib/results-chat";

export function POST(request: Request) {
  return authorizeAdmin(request.headers, "POST") ?? answerResultsChat(request, "private");
}
