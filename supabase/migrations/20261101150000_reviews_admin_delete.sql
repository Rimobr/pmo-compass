-- O Administrador pode apagar avaliações de um projeto (usado por "Apagar dados" do projeto e da base inteira)
create policy "person_reviews_admin_delete" on public.person_reviews for delete using (coalesce(public.current_role(), '') = 'admin');
