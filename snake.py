"""Small, dependency-free Snake game for Skai capability testing.

Run ``python snake.py`` for the Tk game or ``python snake.py --self-test``
for a headless smoke test suitable for CI and agent verification.
"""

from __future__ import annotations

import argparse
import random
import tkinter as tk
from dataclasses import dataclass


@dataclass(frozen=True)
class Point:
    x: int
    y: int


class SnakeGame:
    def __init__(self, size: int = 20, seed: int | None = None) -> None:
        self.size = size
        self.random = random.Random(seed)
        self.snake = [Point(size // 2, size // 2), Point(size // 2 - 1, size // 2)]
        self.direction = Point(1, 0)
        self.score = 0
        self.game_over = False
        self.food = self._new_food()

    def _new_food(self) -> Point:
        open_cells = [
            Point(x, y)
            for y in range(self.size)
            for x in range(self.size)
            if Point(x, y) not in self.snake
        ]
        return self.random.choice(open_cells)

    def turn(self, direction: Point) -> None:
        if direction.x + self.direction.x == 0 and direction.y + self.direction.y == 0:
            return
        self.direction = direction

    def step(self) -> bool:
        if self.game_over:
            return False
        head = self.snake[0]
        next_head = Point(head.x + self.direction.x, head.y + self.direction.y)
        if not (0 <= next_head.x < self.size and 0 <= next_head.y < self.size):
            self.game_over = True
            return False
        eating = next_head == self.food
        body = self.snake if eating else self.snake[:-1]
        if next_head in body:
            self.game_over = True
            return False
        self.snake.insert(0, next_head)
        if eating:
            self.score += 1
            if len(self.snake) == self.size * self.size:
                self.game_over = True
            else:
                self.food = self._new_food()
        else:
            self.snake.pop()
        return True


class SnakeWindow:
    CELL = 24

    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.game = SnakeGame()
        self.root.title("Skai Snake")
        self.root.resizable(False, False)
        self.label = tk.Label(root, text="Score: 0", font=("Segoe UI", 12), pady=8)
        self.label.pack()
        self.canvas = tk.Canvas(root, width=20 * self.CELL, height=20 * self.CELL, bg="#101522", highlightthickness=0)
        self.canvas.pack()
        self.root.bind("<Key>", self.on_key)
        self.draw()
        self.tick()

    def on_key(self, event: tk.Event) -> None:
        directions = {"Up": Point(0, -1), "Down": Point(0, 1), "Left": Point(-1, 0), "Right": Point(1, 0)}
        if event.keysym in directions:
            self.game.turn(directions[event.keysym])
        elif event.keysym.lower() == "r" and self.game.game_over:
            self.game = SnakeGame()
        self.draw()

    def draw(self) -> None:
        self.canvas.delete("all")
        for point in self.game.snake:
            color = "#7ce7ef" if point == self.game.snake[0] else "#4bb8c7"
            self.canvas.create_rectangle(point.x * self.CELL + 2, point.y * self.CELL + 2, (point.x + 1) * self.CELL - 2, (point.y + 1) * self.CELL - 2, fill=color, outline="")
        food = self.game.food
        self.canvas.create_oval(food.x * self.CELL + 5, food.y * self.CELL + 5, (food.x + 1) * self.CELL - 5, (food.y + 1) * self.CELL - 5, fill="#ff7a91", outline="")
        self.label.config(text=f"Score: {self.game.score}" + ("  — Game over; press R" if self.game.game_over else ""))

    def tick(self) -> None:
        self.game.step()
        self.draw()
        self.root.after(120, self.tick)


def self_test() -> None:
    game = SnakeGame(size=8, seed=7)
    game.food = Point(game.snake[0].x + 1, game.snake[0].y)
    assert game.step() and game.score == 1 and len(game.snake) == 3
    game.turn(Point(0, -1))
    for _ in range(20):
        if not game.step():
            break
    assert game.game_over, "boundary collision should end the game"
    print("Snake self-test passed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
    else:
        window = tk.Tk()
        SnakeWindow(window)
        window.mainloop()
