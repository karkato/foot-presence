export interface Player {
  id: string;
  group_id: string;
  username: string;
  display_name: string | null;
  is_admin: boolean;
  created_at: string;
}

export function getDisplayName(player: Pick<Player, 'display_name' | 'username'>): string {
  return player.display_name?.trim() || player.username;
}
