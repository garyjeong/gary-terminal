from gary_terminal.tui.app import GaryTerminalApp


async def test_theme_registered_and_switch():
    app = GaryTerminalApp()
    async with app.run_test():
        assert "gary-dark" in app.available_themes
        app.theme = "gary-light"
        assert app.theme == "gary-light"
