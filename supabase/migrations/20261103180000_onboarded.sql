-- A tela de boas-vindas aparece só na primeira vez de cada conta: a marca fica junto do cadastro da pessoa (a política "só o dono altera" já vale)
alter table public.profile_details add column if not exists onboarded_at timestamptz;
