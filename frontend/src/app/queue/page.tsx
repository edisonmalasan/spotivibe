import { QueueView } from "@/features/queue/QueueView";

/**
 * M6 queue route (design §5): dedicated surface for inspecting and editing
 * the queue — now playing, upcoming in traversal order, and played history.
 */
export default function QueuePage() {
  return <QueueView />;
}
