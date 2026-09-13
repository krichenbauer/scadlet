{
  description = "Visual OpenSCAD development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-darwin" "x86_64-darwin" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in {
      devShells = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
        in {
          default = pkgs.mkShell ({
            packages = with pkgs; [
              nodejs_24
              pnpm
              git
            ] ++ pkgs.lib.optionals pkgs.stdenv.isLinux [ pkgs.chromium ];

            shellHook = ''
              echo "SCADlet development shell"
              echo "  pnpm install       Install JavaScript dependencies"
              echo "  pnpm dev           Start the Vite development server"
              echo "  pnpm test          Run unit tests"
              echo "  pnpm test:e2e      Run browser tests"
              echo "  pnpm build         Type-check and build the app"
              echo "  pnpm preview       Preview the production build"
            '';
          } // pkgs.lib.optionalAttrs pkgs.stdenv.isLinux {
            PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = "${pkgs.chromium}/bin/chromium";
            CHROMIUM_EXECUTABLE_PATH = "${pkgs.chromium}/bin/chromium";
          });
        });
    };
}
