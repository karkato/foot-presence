#!/usr/bin/env node
/**
 * Import joueurs depuis un fichier texte (un nom par ligne)
 *
 * Usage:
 *   npx tsx scripts/import-players.ts --group="Les gars du dimanche" --file=import-players.txt
 *
 * Config: fichier .env à la racine du projet avec :
 *   SUPABASE_URL=...
 *   SUPABASE_SERVICE_ROLE_KEY=...
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Charge le .env manuellement (sans dotenv)
function loadEnv(): void {
  try {
    const envPath = resolve(process.cwd(), '.env');
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [key, ...rest] = trimmed.split('=');
      process.env[key.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    // .env optionnel
  }
}

function randomPin(length = 4): string {
  return Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
}

function parseArgs(): { group: string; file: string } {
  const args = process.argv.slice(2);
  const group = args.find((a) => a.startsWith('--group='))?.slice(8) ?? '';
  const file = args.find((a) => a.startsWith('--file='))?.slice(7) ?? '';
  if (!group || !file) {
    console.error('Usage: npx tsx scripts/import-players.ts --group="Nom du groupe" --file=joueurs.txt');
    process.exit(1);
  }
  return { group, file };
}

async function main(): Promise<void> {
  loadEnv();

  const { group: groupName, file: filePath } = parseArgs();

  const supabaseUrl = process.env['SUPABASE_URL'];
  const supabaseKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!supabaseUrl || !supabaseKey) {
    console.error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis dans .env');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Lire le fichier de joueurs
  const content = readFileSync(resolve(process.cwd(), filePath), 'utf-8');
  const names = content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (names.length === 0) {
    console.error('Aucun joueur dans le fichier');
    process.exit(1);
  }

  // Vérifier/créer le groupe
  let { data: group } = await supabase
    .from('groups')
    .select('*')
    .eq('name', groupName)
    .single();

  if (!group) {
    const slug = groupName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const { data: newGroup, error } = await supabase
      .from('groups')
      .insert({ name: groupName, slug })
      .select()
      .single();

    if (error || !newGroup) {
      console.error('Erreur création groupe :', error?.message);
      process.exit(1);
    }
    group = newGroup;
    console.log(`Groupe créé : "${groupName}" (slug: ${slug})`);
  } else {
    console.log(`Groupe trouvé : "${groupName}"`);
  }

  // Récupérer les joueurs existants
  const { data: existing } = await supabase
    .from('players')
    .select('username')
    .eq('group_id', group.id);
  const existingUsernames = new Set((existing ?? []).map((p) => p.username));

  // Importer les joueurs
  const results: Array<{ name: string; username: string; pin: string; status: string }> = [];

  for (const name of names) {
    const username = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
    const pin = randomPin(4);

    if (existingUsernames.has(username)) {
      results.push({ name, username, pin: '----', status: 'déjà existant' });
      continue;
    }

    const { error } = await supabase.rpc('create_player', {
      p_group_id: group.id,
      p_username: username,
      p_pin: pin,
      p_display_name: name,
      p_is_admin: false,
    });

    if (error) {
      results.push({ name, username, pin: '----', status: `ERREUR: ${error.message}` });
    } else {
      results.push({ name, username, pin, status: 'créé' });
    }
  }

  // Affichage du récapitulatif
  console.log('');
  console.log(`=== Comptes — ${groupName} ===`);
  console.log('');

  const maxName = Math.max(...results.map((r) => r.name.length), 10);
  const maxUser = Math.max(...results.map((r) => r.username.length), 8);

  for (const r of results) {
    const namePad = r.name.padEnd(maxName);
    const userPad = r.username.padEnd(maxUser);
    const pinStr = r.pin !== '----' ? `PIN: ${r.pin}` : r.status;
    console.log(`  ${namePad}  @${userPad}  ${pinStr}`);
  }

  const appUrl = `${supabaseUrl.replace('supabase.co', 'vercel.app')}`;
  console.log('');
  console.log(`=`.repeat(40));
  console.log(`Lien app : https://votre-app.vercel.app/${group.slug}`);
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
