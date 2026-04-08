export class RunarcanaLoginDialog {
  constructor(firebaseClient) {
    this.firebaseClient = firebaseClient;
  }

  async render(force = true) {
    const { DialogV2 } = foundry.applications.api;

    return DialogV2.wait({
      window: { title: "Runarcana Sync Login" },
      content: `
        <form>
          <p>Entre com email e senha ou use a conta Google habilitada no Firebase Authentication.</p>
          <div class="form-group">
            <label>Email:</label>
            <input type="text" name="email" autofocus />
          </div>
          <div class="form-group">
            <label>Senha:</label>
            <input type="password" name="password" />
          </div>
        </form>
      `,
      buttons: [{
        action: "google",
        label: "Google",
        icon: "fab fa-google",
        callback: async (event, button, dialog) => {
          try {
            await this.firebaseClient.loginWithGoogle();
            ui.notifications.info("Runarcana Sync: Login com Google realizado com sucesso!");
          } catch (err) {
            ui.notifications.error("Erro no login com Google: " + err.message);
          }
        }
      }, {
        action: "login",
        label: "Login",
        icon: "fas fa-check",
        default: true,
        callback: async (event, button, dialog) => {
          const email = dialog.element.querySelector('[name="email"]').value;
          const pass = dialog.element.querySelector('[name="password"]').value;
          try {
            await this.firebaseClient.login(email, pass);
            ui.notifications.info("Runarcana Sync: Login realizado com sucesso!");
          } catch (err) {
            ui.notifications.error("Erro no login: " + err.message);
          }
        }
      }]
    });
  }
}
