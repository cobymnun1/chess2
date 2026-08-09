import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import { tileToCell } from "../../../core/chess/ChessMoves";
import { GameMapType, PlayerActions, UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { Controller } from "../../Controller";
import { TransformHandler } from "../../TransformHandler";
import { UIState } from "../../UIState";
import { GameView, PlayerView } from "../../view";
import { BuildMenu } from "./BuildMenu";
import { ChatIntegration } from "./ChatIntegration";
import { EmojiTable } from "./EmojiTable";
import { PlayerActionHandler } from "./PlayerActionHandler";
import { PlayerPanel } from "./PlayerPanel";
import { RadialMenu, RadialMenuConfig } from "./RadialMenu";
import {
  centerButtonElement,
  COLORS,
  MenuElementParams,
  rootMenuElement,
} from "./RadialMenuElements";
const donateTroopIcon = assetUrl("images/DonateTroopIconWhite.svg");
const swordIcon = assetUrl("images/SwordIconWhite.svg");

import { ContextMenuEvent } from "../../InputHandler";

export class MainRadialMenu implements Controller {
  private radialMenu: RadialMenu;

  private playerActionHandler: PlayerActionHandler;
  private chatIntegration: ChatIntegration;

  private clickedTile: TileRef | null = null;

  getTickIntervalMs() {
    return 500;
  }

  constructor(
    private eventBus: EventBus,
    private game: GameView,
    private transformHandler: TransformHandler,
    private emojiTable: EmojiTable,
    private buildMenu: BuildMenu,
    private uiState: UIState,
    private playerPanel: PlayerPanel,
  ) {
    const menuConfig: RadialMenuConfig = {
      centerButtonIcon: swordIcon,
      tooltipStyle: `
        .radial-tooltip .cost {
          margin-top: 4px;
          color: ${COLORS.tooltip.cost};
        }
        .radial-tooltip .count {
          color: ${COLORS.tooltip.count};
        }
      `,
    };

    this.radialMenu = new RadialMenu(
      this.eventBus,
      rootMenuElement,
      centerButtonElement,
      menuConfig,
    );

    this.playerActionHandler = new PlayerActionHandler(
      this.eventBus,
      this.uiState,
    );

    this.chatIntegration = new ChatIntegration(this.game, this.eventBus);
  }

  init() {
    this.radialMenu.init();
    this.eventBus.on(ContextMenuEvent, (event) => {
      const worldCoords = this.transformHandler.screenToWorldCoordinates(
        event.x,
        event.y,
      );
      if (!this.game.isValidCoord(worldCoords.x, worldCoords.y)) {
        return;
      }
      const myPlayer = this.game.myPlayer();
      if (myPlayer === null) {
        return;
      }
      this.clickedTile = this.game.ref(worldCoords.x, worldCoords.y);

      // Chess Workshop: production radial is handled by ChessFactoryController.
      if (
        this.game.config().gameConfig().gameMap === GameMapType.Grid &&
        this.isOwnWorkshop(myPlayer, this.clickedTile)
      ) {
        return;
      }

      myPlayer.actions(this.clickedTile).then((actions) => {
        this.updatePlayerActions(
          myPlayer,
          actions,
          this.clickedTile!,
          event.x,
          event.y,
        );
      });
    });
  }

  private isOwnWorkshop(myPlayer: PlayerView, tile: TileRef): boolean {
    const cell = tileToCell(this.game, tile);
    return myPlayer.units(UnitType.Workshop).some((u) => {
      if (!u.isActive()) return false;
      const c = tileToCell(this.game, u.tile());
      return c.cx === cell.cx && c.cy === cell.cy;
    });
  }

  private async updatePlayerActions(
    myPlayer: PlayerView,
    actions: PlayerActions,
    tile: TileRef,
    screenX: number | null = null,
    screenY: number | null = null,
  ) {
    this.buildMenu.playerBuildables = actions.buildableUnits;

    const tileOwner = this.game.owner(tile);
    const recipient = tileOwner.isPlayer() ? (tileOwner as PlayerView) : null;

    if (myPlayer && recipient) {
      this.chatIntegration.setupChatModal(myPlayer, recipient);
    }

    const params: MenuElementParams = {
      myPlayer,
      selected: recipient,
      tile,
      playerActions: actions,
      game: this.game,
      buildMenu: this.buildMenu,
      emojiTable: this.emojiTable,
      playerActionHandler: this.playerActionHandler,
      playerPanel: this.playerPanel,
      chatIntegration: this.chatIntegration,
      uiState: this.uiState,
      closeMenu: () => this.closeMenu(),
      eventBus: this.eventBus,
    };

    const isFriendlyTarget =
      recipient !== null &&
      recipient.isFriendly(myPlayer) &&
      !recipient.isDisconnected();

    this.radialMenu.setCenterButtonAppearance(
      isFriendlyTarget ? donateTroopIcon : swordIcon,
      isFriendlyTarget ? "#22d3ee" : "#0f2744",
      isFriendlyTarget
        ? this.radialMenu.getDefaultCenterIconSize() * 0.75
        : this.radialMenu.getDefaultCenterIconSize(),
    );

    this.radialMenu.setParams(params);
    if (screenX !== null && screenY !== null) {
      this.radialMenu.showRadialMenu(screenX, screenY);
    } else {
      this.radialMenu.refresh();
    }
  }

  async tick() {
    if (!this.radialMenu.isMenuVisible() || this.clickedTile === null) return;
    this.game
      .myPlayer()!
      .actions(this.clickedTile)
      .then((actions) => {
        this.updatePlayerActions(
          this.game.myPlayer()!,
          actions,
          this.clickedTile!,
        );
      });
  }

  closeMenu() {
    if (this.radialMenu.isMenuVisible()) {
      this.radialMenu.hideRadialMenu();
    }

    if (this.buildMenu.isVisible) {
      this.buildMenu.hideMenu();
    }

    if (this.emojiTable.isVisible) {
      this.emojiTable.hideTable();
    }

    if (this.playerPanel.isVisible) {
      this.playerPanel.hide();
    }
  }
}
