export class RunarcanaLoginDialog extends Dialog {
  constructor(firebaseClient) {
    super({
      title: "Runarcana Sync Login",
      content: `
        <form>
          <div class="form-group">
            <label>Email:</label>
            <input type="text" name="email" />
          </div>
          <div class="form-group">
            <label>Senha:</label>
            <input type="password" name="password" />
          </div>
        </form>
      `,
      buttons: {
        login: {
          icon: '<i class="fas fa-check"></i>',
          label: "Login",
          callback: async (html) => {
            const email = html.find('[name="email"]').val();
            const pass = html.find('[name="password"]').val();
            try {
              await firebaseClient.login(email, pass);
              ui.notifications.info("Runarcana Sync: Login realizado com sucesso!");
            } catch (err) {
              ui.notifications.error("Erro no login: " + err.message);
            }
          }
        }
      }
    });
  }
}
