-- ============================================================
-- foot-presence — Données réelles
-- À exécuter APRÈS setup.sql
-- ============================================================

-- Nettoyage
DELETE FROM groups WHERE id = '00000000-0000-0000-0000-000000000001';

-- Groupe
INSERT INTO groups (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000001', 'Foot Vanves', 'foot-vanves');

-- Joueurs (PIN par défaut : 1234 — à changer via la page profil)
SELECT create_player('00000000-0000-0000-0000-000000000001', 'nagz',      '1234', 'Nagz',        true);
SELECT create_player('00000000-0000-0000-0000-000000000001', 'omar',      '1234', 'Omar',        true);
SELECT create_player('00000000-0000-0000-0000-000000000001', 'lucas',     '1234', 'Lucas');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'm10',       '1234', 'M10');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'abed',      '1234', 'Abed');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'alex',      '1234', 'Alex');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'alexandre', '1234', 'Alexandre S.');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'alexis',    '1234', 'Alexis');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'anis',      '1234', 'Anis');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'bee',       '1234', 'Bee');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'billy',     '1234', 'Billy');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'camille',   '1234', 'Camille');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'charles',   '1234', 'Charles');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'ephraiml',  '1234', 'EphraimL');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'fares',     '1234', 'Fares');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'hadrien',   '1234', 'Hadrien');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'hassan',    '1234', 'Hassan');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'idir',      '1234', 'Idir');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'jamal',     '1234', 'Jamal');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'jules',     '1234', 'Jules');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'loic',      '1234', 'Loic');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'loic.j',    '1234', 'Loic J.');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'manon',     '1234', 'Manon');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'micka',     '1234', 'Micka');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'mikado',    '1234', 'Mikado J.');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'mt',        '1234', 'MT');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'maro',      '1234', 'Maro');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'romain',    '1234', 'Romain');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'sacha',     '1234', 'Sacha J.');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'sidhoum',   '1234', 'Sidhoum');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'umay',      '1234', 'Umay S.');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'thibaud',   '1234', 'Thibaud');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'tim',       '1234', 'Tim');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'yanis',     '1234', 'Yanis');
SELECT create_player('00000000-0000-0000-0000-000000000001', 'zakaria',   '1234', 'Zakaria S.');
