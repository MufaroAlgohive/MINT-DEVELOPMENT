import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const CONFIG = {
  COLORS: {
    P:        [59,  27,  122],
    P_MID:    [91,  33,  182],
    P_DIM:    [130, 95,  210],
    P_LITE:   [237, 233, 254],
    P_PALE:   [246, 244, 255],
    P_STRIPE: [228, 222, 250],
    P_RULE:   [190, 175, 235],
    WHITE:    [255, 255, 255],
    DARK:     [18,  21,  38 ],
    BODY:     [50,  35,  90 ],
    GREEN:    [22,  163, 74 ],
    RED:      [220, 38,  38 ],
    DIV:      [210, 200, 240],
  },
  PAGE: { WIDTH: 210, HEIGHT: 297 },
  MARGIN: { LEFT: 13, RIGHT: 13, HEADER: 30 },
  LEFT_WIDTH: 117,
  GAP: 5,
  FONT: { HEAD: 8, SUBHEAD: 6.5, BODY: 7, SMALL: 6.1, TABLE: 7.1, FOOTER: 5.9 },
  LOGO_ASPECT: 6293.27 / 2757.71,
};

const PW = CONFIG.PAGE.WIDTH;
const PH = CONFIG.PAGE.HEIGHT;
const ML = CONFIG.MARGIN.LEFT;
const MR = CONFIG.MARGIN.RIGHT;
const HDR = CONFIG.MARGIN.HEADER;
const LW = CONFIG.LEFT_WIDTH;
const RX = ML + LW + CONFIG.GAP;
const RW = PW - MR - RX;

const MINT_LOGO_SVG_B64 = "PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyBpZD0iTGF5ZXJfMiIgZGF0YS1uYW1lPSJMYXllciAyIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2MjkzLjI3IDI3NTcuNzEiPgogIDxkZWZzPgogICAgPHN0eWxlPgogICAgICAuY2xzLTEgewogICAgICAgIGZpbGw6ICNmZmY7CiAgICAgIH0KICAgIDwvc3R5bGU+CiAgPC9kZWZzPgogIDxnIGlkPSJMYXllcl8xLTIiIGRhdGEtbmFtZT0iTGF5ZXIgMSI+CiAgICA8Zz4KICAgICAgPGc+CiAgICAgICAgPHBhdGggY2xhc3M9ImNscy0xIiBkPSJNMzMzMy4xOSwyODAuOGMyNi43OSwxMy4wNywxNy42OCw1My4zNS0xMi4xMyw1My42Mmgwcy01NDIuNjMsMC01NDIuNjMsMGMtMTUuNiwwLTI4LjI0LDEyLjY0LTI4LjI0LDI4LjI0djI0MS40YzAsMTUuNi0xMi42NCwyOC4yNC0yOC4yNCwyOC4yNGgtNTE0LjM2Yy0xNS42LDAtMjguMjQtMTIuNjQtMjguMjQtMjguMjR2LTI2My4yM2MwLTEwLjExLDUuNC0xOS40NSwxNC4xNy0yNC40OEwyNzM3LjIzLDMuNzZjOC4xMy00LjY3LDE4LjA0LTUuMDEsMjYuNDYtLjlsNTY5LjUsMjc3Ljk0WiIvPgogICAgICAgIDxwYXRoIGNsYXNzPSJjbHMtMSIgZD0iTTI5NjAuMDcsNDg0LjYyYy0yNi43OS0xMy4wNy0xNy42OC01My4zNSwxMi4xMy01My42MmgwczU0Mi42MywwLDU0Mi42MywwYzE1LjYsMCwyOC4yNC0xMi42NCwyOC4yNC0yOC4yNHYtMjQxLjRjMC0xNS42LDEyLjY0LTI4LjI0LDI4LjI0LTI4LjI0aDUxNC4zNmMxNS42LDAsMjguMjQsMTIuNjQsMjguMjQsMjguMjR2MjYzLjIzYzAsMTAuMTEtNS40LDE5LjQ1LTE0LjE3LDI0LjQ4bC01NDMuNzEsMzEyLjU5Yy04LjEzLDQuNjctMTguMDQsNS4wMS0yNi40Ni45bC01NjkuNS0yNzcuOTRaIi8+CiAgICAgIDwvZz4KICAgICAgPGc+CiAgICAgICAgPHBhdGggY2xhc3M9ImNscy0xIiBkPSJNMCwyMzM3LjM2di05MjYuMjNjMC05MS4yOSwzMi4yOC0xNjkuNTgsOTYuODUtMjM0LjksNjUuMy02NC41NywxNDMuNjEtOTYuODUsMjM0LjktOTYuODVoMjQuNDljMTA0LjY1LDAsMTk0LjA3LDM3LjEzLDI2OC4yOSwxMTEuMzMsNDAuODEsNDAuODMsNzAuNSw4Ni40Nyw4OS4wNiwxMzYuOTNsMzMwLjYzLDY2Mi4zOCwzMzAuNjQtNjYyLjM4YzE4LjU0LTUwLjQ2LDQ4LjYtOTYuMSw5MC4xOC0xMzYuOTMsNzQuMjEtNzQuMiwxNjMuNjUtMTExLjMzLDI2OC4yOS0xMTEuMzhoMjMuMzhjOTIuMDIsMCwxNzAuMzMsMzIuMjgsMjM0LjksOTYuODUsNjUuMyw2NS4zMiw5Ny45NywxNDMuNjIsOTcuOTcsMjM0Ljl2OTI2LjIzaC0zNzkuNjJ2LTc4My43M2MwLTEyLjYxLTQuODQtMjMuNzQtMTQuNDctMzMuNC05LjY1LTguOS0yMC43OS0xMy4zNi0zMy40LTEzLjM2LTYuNjgsMC0xMi45OSwxLjEyLTE4LjkyLDMuMzQtNS4yMSwyLjIyLTEwLjAyLDUuNTctMTQuNDgsMTAuMDJoLTEuMTFsLTQwOC41Nyw4MTcuMTRoLTM0OC40NWwtMTkwLjM3LTM3OS42My0yMTkuMzEtNDM3LjUxYy00LjQ2LTQuNDUtOS42NS03Ljc5LTE1LjU5LTEwLjAyLTUuOTQtMi4yMi0xMS44OC0zLjM0LTE3LjgxLTMuMzQtMTMuMzYsMC0yNC44OCw0LjQ2LTM0LjUyLDEzLjM2LTguOSw5LjY2LTEzLjM2LDIwLjgtMTMuMzYsMzMuNHY3ODMuNzNIMFoiLz4KICAgICAgICA8cGF0aCBjbGFzcz0iY2xzLTEiIGQ9Ik0yMjc5Ljk2LDIzMzcuMzZ2LTEyMzQuNmgzNzkuNjJ2MTIzNC42aC0zNzkuNjJaIi8+CiAgICAgICAgPHBhdGggY2xhc3M9ImNscy0xIiBkPSJNNDIyNy4wNiwyMzYwLjczYy0xMDQuNjYsMC0xOTQuMDktMzYuNzMtMjY4LjMxLTExMC4yMS0yLjk4LTIuMjItNS41NS00LjgyLTcuNzktNy43OWgtMS4xMmwtMTMuMzQtMTYuN2MtMi45OC0yLjk1LTUuNTctNS45Mi03LjgxLTguOWwtNDU0LjItNTQ0LjM5LTE3MS40NC0yMDUuOTVjLTIuMjQtMS40Ny00Ljg1LTIuOTYtNy44MS00LjQ1LTUuOTQtMi4yMi0xMS44OC0zLjM0LTE3LjgxLTMuMzQtMTMuMzYsMC0yNC44OCw0LjgzLTM0LjUyLDE0LjQ4LTguOSw4LjktMTMuMzYsMjAuMDMtMTMuMzYsMzMuMzl2ODMwLjVoLTM3OS42MnYtOTI2LjIzYzAtOTEuMjksMzIuMjgtMTY5LjU4LDk2Ljg1LTIzNC45LDY1LjMtNjQuNTcsMTQzLjYxLTk2Ljg1LDIzNC45LTk2Ljg1aDI0LjQ5YzEwNC42NCwwLDE5NC4wNywzNy4xMywyNjguMywxMTEuMzMsMi4yMSwyLjIyLDQuNDUsNC40NSw2LjY3LDYuNjdoMS4xbDE0LjQ4LDE2LjdjMi4yMiwyLjk4LDQuNDYsNS45NSw2LjY3LDguOTFsNjI1LjY3LDc1MC4zNGMyLjIyLDIuMjIsNC44MiwzLjcxLDcuNzksNC40NSw1Ljk0LDIuMjIsMTIuMjQsMy4zNCwxOC45MywzLjM0LDEyLjYxLDAsMjMuNzQtNC40NiwzMy40LTEzLjM2LDkuNjMtOS42NSwxNC40Ni0yMC43OCwxNC40Ni0zMy40di04MzEuNmgzNzkuNjF2OTI2LjIzYzAsOTIuMDQtMzIuNjcsMTcwLjMyLTk3Ljk2LDIzNC44OS02NC41Nyw2NC41Ny0xNDIuODgsOTYuODUtMjM0LjksOTYuODVoLTIzLjM2WiIvPgogICAgICAgIDxwYXRoIGNsYXNzPSJjbHMtMSIgZD0iTTUyOTUuNzksMjMzNy4zNnYtOTQ5LjYxaC02MTYuNzZ2LTI4NWgxNjE0LjIzdjI4NWgtNjE3Ljg2djk0OS42MWgtMzc5LjYxWiIvPgogICAgICA8L2c+CiAgICAgIDxnPgogICAgICAgIDxwYXRoIGNsYXNzPSJjbHMtMSIgZD0iTTAsMjc1NC40NnYtMTU1LjdoMjAuNDRsNTYuNDQsMTE3LjA5LDU2LjExLTExNy4wOWgyMC42NXYxNTUuNTloLTIxLjQxdi0xMDYuNTFsLTUwLjI4LDEwNi42MWgtMTAuMjdsLTUwLjM4LTEwNi42MXYxMDYuNjFIMFoiLz4KICAgICAgICA8cGF0aCBjbGFzcz0iY2xzLTEiIGQ9Ik01NDAuODQsMjc1Ny43MWMtMTUuNTcsMC0yOC44NC0zLjQxLTM5Ljc5LTEwLjIyLTEwLjk2LTYuODEtMTkuMzQtMTYuMy0yNS4xNC0yOC40OS01LjgtMTIuMTgtOC43LTI2LjMxLTguNy00Mi4zOHMyLjktMzAuMjEsOC43LTQyLjM4YzUuOC0xMi4xOSwxNC4xOC0yMS42OCwyNS4xNC0yOC41LDEwLjk1LTYuODEsMjQuMjItMTAuMjEsMzkuNzktMTAuMjFzMjguNzQsMy40MSwzOS43MywxMC4yMWMxMC45OSw2LjgxLDE5LjM3LDE2LjMxLDI1LjE0LDI4LjUsNS43NywxMi4xOCw4LjY1LDI2LjMxLDguNjUsNDIuMzhzLTIuODgsMzAuMjEtOC42NSw0Mi4zOGMtNS43NywxMi4xOS0xNC4xNSwyMS42OC0yNS4xNCwyOC40OS0xMC45OSw2LjgxLTI0LjI0LDEwLjIyLTM5LjczLDEwLjIyWk01NDAuODQsMjczNi4xOWMxMS4wMy4xNSwyMC4yLTIuMjksMjcuNTItNy4zLDcuMzEtNSwxMi44MS0xMiwxNi40OS0yMC45NywzLjY3LTguOTgsNS41MS0xOS40MSw1LjUxLTMxLjNzLTEuODQtMjIuMjktNS41MS0zMS4yYy0zLjY4LTguOS05LjE4LTE1Ljg0LTE2LjQ5LTIwLjgxLTcuMzItNC45OC0xNi40OS03LjUtMjcuNTItNy41Ny0xMS4wMy0uMTQtMjAuMiwyLjI3LTI3LjUyLDcuMjUtNy4zMiw0Ljk3LTEyLjgxLDExLjk2LTE2LjQ5LDIwLjk3LTMuNjcsOS4wMi01LjU1LDE5LjQ2LTUuNjIsMzEuMzYtLjA3LDExLjg5LDEuNzMsMjIuMjksNS40MSwzMS4xOSwzLjY4LDguOSw5LjIxLDE1Ljg0LDE2LjYsMjAuODIsNy4zOSw0Ljk4LDE2LjYsNy41LDI3LjYzLDcuNTdaIi8+CiAgICAgICAgPHBhdGggY2xhc3M9ImNscy0xIiBkPSJNOTI3LjkyLDI3NTQuNDZ2LTE1NS43aDIyLjkybDc2LjY2LDExNS42OXYtMTE1LjY5aDIyLjkydj E1NS43aC0yMi45MmwtNzYuNjYtMTE1Ljh2MTE1LjhoLTIyLjkyWiIvPgogICAgICAgIDxwYXRoIGNsYXNzPSJjbHMtMSIgZD0iTTEzNzIuNjQsMjc1NC40NnYtMTU1LjdoOTkuNDd2MjEuM2gtNzYuODh2NDMuNjhoNjMuOXYyMS4zaC02My45djQ4LjExaDc2Ljg4djIxLjNoLTk5LjQ3WiIvPgogICAgICAgIDxwYXRoIGNsYXNzPSJjbHMtMSIgZD0iTTE4MjcuNTIsMjc1NC40NnYtNjQuMzNsLTUyLjY2LTkxLjM2aDI2LjM4bDM3LjczLDY1LjQxLDM3LjczLTY1LjQxaDI2LjM4bC01Mi42Niw5MS4zNnY2NC4zM2gtMjIuOTJaIi8+CiAgICAgICAgPHBhdGggY2xhc3M9ImNscy0xIiBkPSJNMjUzOC44NywyNzU0LjQ2di0xNTUuN2gyMi42djE1NS43aC0yMi42WiIvPgogICAgICAgIDxwYXRoIGNsYXNzPSJjbHMtMSIgZD0iTTI4ODUuODQsMjc1NC40NnYtMTU1LjdoMjIuOTJsNzYuNjYsMTE1LjY5di0xMTUuNjloMjIuOTJ2MTU1LjdoLTIyLjkybC03Ni42Ni0xMTUuOHYxMTUuOGgtMjIuOTJaIi8+CiAgICAgICAgPHBhdGggY2xhc3M9ImNscy0xIiBkPSJNMzcwNC41NiwyNzU0LjQ2di0xMzQuNGgtNTEuOHYtMjEuM2gxMjYuMTh2MjEuM2gtNTEuNzl2MTM0LjRoLTIyLjZaIi8+CiAgICAgICAgPHBhdGggY2xhc3M9ImNscy0xIiBkPSJNNDA4OC4xOCwyNzU0LjQ2di0xNTUuN2g2Mi45M2MxLjUxLDAsMy4zOS4wNSw1LjYyLjE2LDIuMjMuMTEsNC4zNi4zNCw2LjM4LjcsOC42NSwxLjM3LDE1Ljg3LDQuMzMsMjEuNjgsOC44Nyw1LjgsNC41NCwxMC4xNCwxMC4yNywxMy4wMiwxNy4xOSwyLjg5LDYuOTIsNC4zMywxNC41Niw0LjMzLDIyLjkzLDAsMTIuNC0zLjE3LDIzLjA4LTkuNTIsMzIuMDYtNi4zNCw4Ljk4LTE1Ljg2LDE0LjU4LTI4LjU0LDE2LjgxbC05LjE5LDEuMDhoLTQ0LjEydjU1LjloLTIyLjZaTTQxMTAuNzgsMjY3Ny4xNmgzOS40NmMxLjQ0LDAsMy4wNS0uMDcsNC44MS0uMjIsMS43Ni0uMTUsMy40NC0uMzksNS4wMy0uNzYsNC42MS0xLjA4LDguMzMtMy4wOCwxMS4xNC02LDIuODEtMi45Miw0LjgzLTYuMjksNi4wNS0xMC4xMSwxLjIyLTMuODIsMS44NC03LjY0LDEuODQtMTEuNDZzLS42MS03LjYyLTEuODQtMTEuNDFjLTEuMjItMy43OS0zLjI1LTcuMTQtNi4wNS0xMC4wNS0yLjgxLTIuOTItNi41My00LjkyLTExLjE0LTYtMS41OS0uNDMtMy4yNy0uNzItNS4wMy0uODctMS43Ny0uMTQtMy4zNy0uMjEtNC44MS0uMjFoLTM5LjQ2djU3LjA5Wk00MTc5LjIyLDI3NTQuNDZsLTMwLjcxLTYzLjM2LDIyLjgxLTUuODQsMzMuNzQsNjkuMmgtMjUuODRaIi8+CiAgICAgICAgPHBhdGggY2xhc3M9ImNscy0xIiBkPSJNNDUwOS45NywyNzU0LjQ2bDUwLjYxLTE1NS43aDMyLjU0bDUwLjYxLDE1NS43aC0yMy40NmwtNDYuNjEtMTQyLjA4aDUuODRsLTQ2LjA2LDE0Mi4wOGgtMjMuNDdaTTQ1MzYuMjUsMjcxOS4zMnYtMjEuMmg4MS4zMXYyMS4yaC04MS4zMVoiLz4KICAgICAgICA8cGF0aCBjbGFzcz0iY2xzLTEiIGQ9Ik00OTU1LjEyLDI3NTQuNDZ2LTE1NS43aDIyLjkzbDc2LjY2LDExNS42OXYtMTE1LjY5aDIyLjkydjE1NS43aC0yMi45MmwtNzYuNjYtMTE1Ljh2MTE1LjhoLTIyLjkzWiIvPgogICAgICAgIDxwYXRoIGNsYXNzPSJjbHMtMSIgZD0iTTU0NTYuMjgsMjc1Ny43MWMtMTEuMTcsMC0yMS4yNC0xLjkzLTMwLjIyLTUuNzktOC45OC0zLjg2LTE2LjM2LTkuMzctMjIuMTctMTYuNTQtNS44LTcuMTctOS41Ny0xNS43LTExLjMtMjUuNTdsMjMuNTctMy41N2MyLjM4LDkuNTIsNy4zNSwxNi45MiwxNC45MiwyMi4yMiw3LjU3LDUuMywxNi40LDcuOTUsMjYuNSw3Ljk1LDYuMjcsMCwxMi4wNC0uOTksMTcuMy0yLjk4LDUuMjctMS45OCw5LjUtNC44MiwxMi43MS04LjU0LDMuMjEtMy43MSw0LjgxLTguMTcsNC44MS0xMy4zNSwwLTIuODEtLjQ5LTUuMy0xLjQ2LTcuNDYtLjk3LTIuMTYtMi4zMS00LjA1LTQtNS42Ny0xLjctMS42My0zLjc1LTMuMDMtNi4xNy00LjIyLTIuNDEtMS4xOS01LjA2LTIuMjItNy45NS0zLjA4bC0zOS44OS0xMS43OGMtMy44OS0xLjE1LTcuODYtMi42NS0xMS45LTQuNDktNC4wNC0xLjg0LTcuNzMtNC4yNS0xMS4wOC03LjI0LTMuMzYtMi45OS02LjA3LTYuNy04LjE3LTExLjE0LTIuMDktNC40My0zLjE0LTkuODItMy4xNC0xNi4xNiwwLTkuNTksMi40Ny0xNy43Miw3LjQxLTI0LjM4LDQuOTMtNi42NywxMS42Mi0xMS43MSwyMC4wNi0xNS4xMyw4LjQzLTMuNDIsMTcuODctNS4xNCwyOC4zMy01LjE0LDEwLjUyLjE1LDE5Ljk1LDIuMDIsMjguMjgsNS42Miw4LjMzLDMuNiwxNS4yNSw4Ljc4LDIwLjc2LDE1LjUxLDUuNTEsNi43NCw5LjMxLDE0LjksMTEuNCwyNC40OWwtMjQuMjIsNC4xMWMtMS4wOC01Ljg0LTMuMzktMTAuODctNi45Mi0xNS4wOS0zLjUzLTQuMjItNy44Ni03LjQ2LTEyLjk3LTkuNzMtNS4xMi0yLjI3LTEwLjY3LTMuNDQtMTYuNjYtMy41Mi01Ljc3LS4xNC0xMS4wNC43My0xNS44NCwyLjYtNC43OSwxLjg3LTguNjIsNC41MS0xMS40Niw3Ljg5LTIuODUsMy4zOS00LjI3LDcuMjktNC4yNywxMS42OHMxLjI2LDcuODIsMy43OSwxMC40OWMyLjUyLDIuNjcsNS42NCw0Ljc4LDkuMzUsNi4zMywzLjcyLDEuNTUsNy40MSwyLjgzLDExLjA5LDMuODRsMjguNzYsOC4xMWMzLjYsMS4wMSw3LjY5LDIuMzcsMTIuMjgsNC4wNSw0LjU4LDEuNyw5LjAxLDQuMDUsMTMuMyw3LjA4LDQuMjksMy4wMyw3Ljg0LDcuMDUsMTAuNjUsMTIuMDYsMi44MSw1LjAxLDQuMjIsMTEuMyw0LjIyLDE4Ljg3cy0xLjU4LDE0Ljc2LTQuNzYsMjAuN2MtMy4xNyw1Ljk1LTcuNTEsMTAuOTMtMTMuMDMsMTQuOTItNS41MSw0LTExLjg4LDcuMDEtMTkuMDgsOS4wMy03LjIxLDIuMDEtMTQuODEsMy4wMy0yMi44MSwzLjAzWiIvPgogICAgICAgIDxwYXRoIGNsYXNzPSJjbHMtMSIgZD0iTTU4MzMuMDksMjc1NC40NnYtMTU1LjdoMjIuNnYxNTUuN2gtMjIuNloiLz4KICAgICAgICA8cGF0aCBjbGFzcz0iY2xzLTEiIGQ9Ik02MjE4Ljg4LDI3NTQuNDZ2LTEzNC40aC01MS44di0yMS4zaDEyNi4xOHYyMS4zaC01MS43OXYxMzQuNGgtMjIuNloiLz4KICAgICAgPC9nPgogICAgPC9nPgogIDwvZz4KPC9zdmc+";

const logoCache = new Map();

async function renderLogoToPng(h) {
  const scale = 3;
  const pxH = Math.round(h * scale * (96 / 25.4));
  const pxW = Math.round(pxH * CONFIG.LOGO_ASPECT);
  return new Promise((resolve, reject) => {
    const svgBlob = new Blob([atob(MINT_LOGO_SVG_B64)], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = pxW; canvas.height = pxH;
      canvas.getContext("2d").drawImage(img, 0, 0, pxW, pxH);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png", 0.94));
    };
    img.onerror = reject;
    img.src = url;
  });
}

async function drawMintLogo(doc, x, y, h) {
  if (!logoCache.has(h)) logoCache.set(h, await renderLogoToPng(h));
  const w = h * CONFIG.LOGO_ASPECT;
  doc.addImage(logoCache.get(h), "PNG", x, y, w, h);
}

const C = CONFIG.COLORS;
const tc = (doc, col) => doc.setTextColor(...col);
const fc = (doc, col) => doc.setFillColor(...col);
const dc = (doc, col) => doc.setDrawColor(...col);

function hl(doc, x1, y1, x2, y2, col = C.DIV, w = 0.18) {
  dc(doc, col); doc.setLineWidth(w); doc.line(x1, y1, x2, y2);
}

function fmtPct(v) {
  if (v == null || isNaN(+v)) return "N/A";
  const n = +v * 100;
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function fmtR(v) {
  if (v == null || isNaN(+v)) return "N/A";
  const n = +v;
  if (n >= 1e9) return `R ${(n / 1e9).toFixed(2)}bn`;
  if (n >= 1e6) return `R ${(n / 1e6).toFixed(2)}m`;
  return `R ${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function secHead(doc, label, x, y, w) {
  const PILL_H = 7;
  fc(doc, C.P);
  doc.roundedRect(x, y - 5, w, PILL_H, 1.5, 1.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(CONFIG.FONT.HEAD);
  tc(doc, C.WHITE);
  doc.text(label.toUpperCase(), x + 3, y + 1);
  return y + PILL_H + 3;
}

function subHead(doc, label, x, y, w) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(CONFIG.FONT.SUBHEAD);
  tc(doc, C.P_MID);
  doc.text(label.toUpperCase(), x, y);
  hl(doc, x, y + 1.8, x + w, y + 1.8);
  return y + 5.5;
}

function drawChart(doc, data, x, y, w, h) {
  fc(doc, C.P_LITE);
  doc.roundedRect(x, y, w, h, 2, 2, "F");
  if (!data || data.length < 2) {
    doc.setFontSize(6.5); tc(doc, C.P_DIM);
    doc.text("Chart data unavailable", x + w / 2, y + h / 2 + 1, { align: "center" });
    return;
  }
  const vals = data.map(p => p.v ?? p.value ?? 0);
  const dates = data.map(p => p.d ?? p.date ?? "");
  const minV = Math.min(...vals), maxV = Math.max(...vals);
  const rng = (maxV - minV) || 1, pad = rng * 0.12;
  const yMin = minV - pad, yMax = maxV + pad, yRng = yMax - yMin;
  const cx = x + 18, cy = y + 6, cw = w - 23, ch = h - 18;
  const STEPS = 4;
  doc.setFontSize(5.2); tc(doc, C.P_RULE);
  for (let i = 0; i <= STEPS; i++) {
    const v = yMax - (yRng * i) / STEPS;
    const ly = cy + (ch * i) / STEPS;
    hl(doc, cx, ly, cx + cw, ly, C.P_RULE, 0.1);
    const lbl = v >= 1000 ? v.toFixed(0) : v >= 100 ? v.toFixed(1) : v.toFixed(2);
    doc.text(lbl, cx - 2, ly + 1.6, { align: "right" });
  }
  const step = Math.max(1, Math.floor((dates.length - 1) / 4));
  doc.setFontSize(5); tc(doc, C.P_DIM);
  for (let i = 0; i < dates.length; i += step) {
    const dx = cx + (cw * i) / (dates.length - 1);
    const d = new Date(dates[i]);
    if (!isNaN(d)) doc.text(`${d.toLocaleString("en-ZA", { month: "short" })} ${String(d.getDate()).padStart(2, "0")}`, dx, cy + ch + 5, { align: "center" });
  }
  const pts = vals.map((v, i) => ({ px: cx + (cw * i) / (vals.length - 1), py: cy + ch - ((v - yMin) / yRng) * ch }));
  dc(doc, C.P_MID); doc.setLineWidth(0.7);
  for (let i = 1; i < pts.length; i++) doc.line(pts[i-1].px, pts[i-1].py, pts[i].px, pts[i].py);
  if (pts.length) { fc(doc, C.P); doc.circle(pts[pts.length-1].px, pts[pts.length-1].py, 1, "F"); }
}

function pctHook(d, col) {
  if (d.section === "body" && d.column.index === col) {
    const t = d.cell.text[0] || "";
    d.cell.styles.textColor = t.startsWith("+") ? C.GREEN : t.startsWith("-") ? C.RED : C.DARK;
    d.cell.styles.fontStyle = "bold";
  }
}

const PIE_COLORS = [
  [91,  33,  182], // P_MID
  [124, 58,  237], // Vibrant Purple
  [139, 92,  246], // Soft Purple
  [167, 139, 250], // Lavender
  [196, 181, 253], // Pale Lavender
  [76,  29,  149], // Deep Purple
  [109, 40,  217], // Rich Purple
  [130, 95,  210], // P_DIM
];

function drawPieChart(doc, slices, cx, cy, r) {
  if (!slices?.length) return cy + r + 1;
  const total = slices.reduce((s, sl) => s + sl.pct, 0) || 1;
  const STEPS = 60; let angle = -Math.PI / 2;
  slices.forEach((sl, i) => {
    const sweep = (sl.pct / total) * 2 * Math.PI;
    const col = PIE_COLORS[i % PIE_COLORS.length];
    const pts = [[cx, cy]];
    for (let s = 0; s <= STEPS; s++) {
      const a = angle + (sweep * s) / STEPS;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    fc(doc, col); dc(doc, C.WHITE); doc.setLineWidth(0.3);
    const deltas = pts.slice(1).map((p, j) => [p[0] - pts[j][0], p[1] - pts[j][1]]);
    doc.lines(deltas, pts[0][0], pts[0][1], [1, 1], "FD", true);
    angle += sweep;
  });
  fc(doc, C.WHITE); doc.circle(cx, cy, r * 0.46, "F");
  const LEG_X = cx - r; let legY = cy + r + 6;
  slices.forEach((sl, i) => {
    const col = PIE_COLORS[i % PIE_COLORS.length];
    fc(doc, col); dc(doc, col);
    doc.rect(LEG_X, legY - 2.6 + 0.6, 2.6, 2.6, "F");
    doc.setFont("helvetica", "normal"); doc.setFontSize(5.8); tc(doc, C.BODY);
    const label = sl.name.length > 22 ? sl.name.slice(0, 21) + "…" : sl.name;
    doc.text(`${label}  ${sl.pct.toFixed(1)}%`, LEG_X + 4.6, legY);
    legY += 4.8;
  });
  return legY + 3;
}

async function addDisclosurePage(doc, name, dateStr, monthStr, isoDate, feeRates = {}) {
  const brokerPct  = +((feeRates.BROKER_FEE_RATE              ?? 0.0025) * 100).toFixed(3);
  const walletPct  = +((feeRates.WALLET_TRANSACTION_FEE_RATE  ?? 0.01)   * 100).toFixed(2);
  const ozowPct    = +((feeRates.OZOW_TRANSACTION_FEE_RATE    ?? 0.038)  * 100).toFixed(2);
  const custodyAmt = +(feeRates.ISIN_FEE_PER_ASSET             ?? 69);
  const aumPct     = +((feeRates.AUM_FEE_RATE                 ?? 0.0099) * 100).toFixed(2);
  // override the hardcoded "Fees & Charges" section body with live values
  function buildFeesChargesBody() {
    return `Transaction fee: ${walletPct}% per trade for wallet/EFT payments, ${ozowPct}% for Ozow payments. Broker fee: ${brokerPct}% per trade. Custody and administrative fees: R${custodyAmt} per asset, charged transparently at checkout prior to investment confirmation. AUM fee: ${aumPct}% per annum, accrued daily and settled monthly from the strategy cash sleeve. A full schedule of fees is available on request from MINT.`;
  }
  // Re-declare sections here so we can inject dynamic fee text
  doc.addPage();
  fc(doc, C.P); doc.rect(0, 0, PW, HDR, "F");
  fc(doc, C.P_MID); doc.rect(0, 0, PW, 1.8, "F");
  fc(doc, C.P_MID); doc.rect(0, HDR, PW, 0.7, "F");
  await drawMintLogo(doc, PW - MR - 8 * CONFIG.LOGO_ASPECT, (HDR - 8) / 2, 8);

  doc.setFont("helvetica", "bold"); doc.setFontSize(8); tc(doc, C.WHITE);
  doc.text("MINT STRATEGY FACTSHEET", ML, 11);
  hl(doc, ML, 14, ML + 85, 14);
  doc.setFont("helvetica", "bold"); doc.setFontSize(7.2); tc(doc, C.WHITE);
  doc.text("Important Disclosures, Risk Factors & Legal Notice", ML, 19);
  doc.setFont("helvetica", "normal"); doc.setFontSize(5.2); tc(doc, [160,130,210]);
  doc.text(`${name.toUpperCase()}  ·  ${dateStr}`, ML, 23.5);

  fc(doc, [252, 250, 255]); doc.rect(0, HDR + 0.7, PW, PH - HDR - 0.7, "F");

  const COL_W = (PW - ML - MR - 6) / 2;
  const COL2_X = ML + COL_W + 6;
  const LINE_H = 3.1;
  const SECTION_GAP = 6;

  const sections = [
    { title: "Investment Strategy Provider", isDiamond: false, body: "MINT Platforms (Pty) Ltd (Reg. 2024/644796/07) trading as MINT, 3 Gwen Lane, Sandown, Sandton, provides investment strategy design and portfolio management services through managed investment strategies. Strategies on the MINT platform are not collective investment schemes or pooled funds unless explicitly stated. This document does not constitute financial advice as defined under FAIS Act No. 37 of 2002 and is provided for informational purposes only. Investors should seek independent financial advice prior to investing." },
    { title: "Custody & Asset Safekeeping", isDiamond: false, body: "Client assets are held in custody through an appointed Central Securities Depository Participant (CSDP), via its appointed nominee custodian. Client assets remain fully segregated from MINT's own operating assets at all times." },
    { title: "Nature of Investment Strategies", isDiamond: false, body: "Investment strategies are actively managed portfolios where MINT may rebalance, adjust or change portfolio allocations in accordance with the stated strategy mandate. Rebalancing may occur at any time in response to strategic reallocation, tactical positioning, risk management adjustments, or optimisation of portfolio exposures. These strategies are designed to align with defined investment objectives and risk parameters." },
    { title: "Performance Disclosure", isDiamond: false, body: "Performance information may include historical realised performance and back-tested or simulated results. Back-tested performance is hypothetical, constructed with hindsight, and does not represent actual trading results. It may not reflect real-world liquidity constraints, slippage, or execution costs. Past performance, whether actual or simulated, is not a reliable indicator of future performance. Performance shown is gross of fees unless stated. Individual investor returns may differ based on timing, deposits, withdrawals, costs, and applicable taxes." },
    { title: "Fees & Charges", isDiamond: false, body: buildFeesChargesBody() },
    { title: "Investment Risk Disclosure", isDiamond: false, body: "The value of investments may increase or decrease and investors may lose part or all of their invested capital. Strategies are subject to: Market Risk, Equity Risk, Volatility Risk, Derivative Risk, Leverage Risk, Liquidity Risk, Counterparty Risk, Concentration Risk, Correlation Risk, Foreign Market Risk, Strategy Risk, Rebalancing Risk, and Model & Back-Test Risk. Where strategies include foreign investments, performance may also be affected by foreign exchange movements, political and regulatory risk, and settlement risk." },
    { title: "Market & Equity Risk", isDiamond: true, body: "Investment strategies are exposed to general market movements. Share prices may fluctuate due to company-specific factors, earnings performance, competitive pressures, or broader macroeconomic and sector conditions. Equity investments may experience periods of significant volatility." },
    { title: "Liquidity & Concentration Risk", isDiamond: true, body: "Liquidity risk arises when securities cannot be bought or sold quickly enough to prevent or minimise losses. In certain market environments, liquidity may deteriorate and trades may execute at prices that differ from expected levels. Concentration risk arises from holding large positions in specific securities, sectors, or regions, increasing sensitivity to adverse events affecting those positions." },
    { title: "Leverage & Counterparty Risk", isDiamond: true, body: "Where leverage is employed, adverse market movements may result in amplified losses. Counterparty risk refers to the risk that a financial institution or trading counterparty may fail to fulfil its contractual obligations in relation to derivative contracts, settlement arrangements, or other financial transactions." },
    { title: "Model, Back-Test & Strategy Risk", isDiamond: true, body: "Strategies relying on quantitative models or back-tested simulations present inherent limitations as results are constructed using historical data with the benefit of hindsight. Actual investment outcomes may differ materially from simulated results. There is no assurance that a strategy will achieve its intended objective. Rebalancing may result in transaction costs and may not always produce favourable outcomes." },
    { title: "Liquidity & Withdrawal Considerations", isDiamond: true, body: "Investments are subject to market liquidity. Where large withdrawals occur or where underlying market liquidity is constrained, withdrawal requests may be processed over time to ensure orderly portfolio management and investor protection." },
    { title: "Conflicts of Interest", isDiamond: true, body: "MINT is committed to fair treatment of all investors. No investor will receive preferential fee or liquidity terms within the same investment strategy unless explicitly disclosed. Where commissions or incentives are payable to third parties, such arrangements will be disclosed in accordance with applicable regulatory requirements." },
  ];

  const leftSections = sections.filter((_, i) => i % 2 === 0);
  const rightSections = sections.filter((_, i) => i % 2 === 1);
  const startY = HDR + 10;

  function renderSectionColumn(secList, colX, colW, startY) {
    let y = startY;
    secList.forEach(sec => {
      const headerBg = sec.isDiamond ? [232, 226, 252] : C.P;
      const headerTc = sec.isDiamond ? C.P : C.WHITE;
      const dotCol = sec.isDiamond ? C.P_MID : C.WHITE;
      const PILL_H = 6.8;
      fc(doc, headerBg);
      doc.roundedRect(colX, y, colW, PILL_H, 1.5, 1.5, "F");
      fc(doc, dotCol);
      doc.rect(colX + 3, y + 2.4, 1.6, 1.6, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(6.4); tc(doc, headerTc);
      doc.text(sec.title.toUpperCase(), colX + 6.8, y + 4.5);
      y += PILL_H + 3.5;
      doc.setFont("helvetica", "normal"); doc.setFontSize(6.1); tc(doc, C.BODY);
      const lines = doc.splitTextToSize(sec.body, colW - 3);
      doc.text(lines, colX + 1.5, y);
      y += lines.length * LINE_H + SECTION_GAP;
    });
    return y;
  }

  const leftEnd = renderSectionColumn(leftSections, ML, COL_W, startY);
  const rightEnd = renderSectionColumn(rightSections, COL2_X, COL_W, startY);

  const disclaimerY = Math.max(leftEnd, rightEnd) + 6;
  const disclaimerText = "This document is confidential and issued for the information of addressees and clients of MINT Platforms (Pty) Ltd only. Subject to copyright; may not be reproduced without prior written permission. Information and opinions are provided for informational purposes only and are not statements of fact. No representation or warranty is made that any strategy will achieve its objectives or generate profits. All investments carry risk; investors may lose part or all of invested capital. This document may include simulated or back-tested results which are hypothetical, constructed with hindsight, and do not represent actual trading. Performance is gross of fees unless stated. Strategies referenced are not collective investment schemes unless explicitly stated. This document does not constitute financial advice, an offer to sell, or a solicitation under FAIS Act No. 37 of 2002. The Manager accepts no liability for direct, indirect or consequential loss arising from use of, or reliance on, this document. Strategies may be modified or withdrawn at the Manager's discretion without prior notice.";
  const disclaimerLines = doc.splitTextToSize(disclaimerText, PW - ML - MR - 6);
  const disclaimerH = disclaimerLines.length * 2.65 + 14;

  fc(doc, [240, 236, 255]);
  doc.roundedRect(ML, disclaimerY, PW - ML - MR, disclaimerH, 2.5, 2.5, "F");
  dc(doc, C.P_MID); doc.setLineWidth(0.6);
  doc.roundedRect(ML, disclaimerY, PW - ML - MR, disclaimerH, 2.5, 2.5, "S");

  doc.setFont("helvetica", "bold"); doc.setFontSize(7); tc(doc, C.P);
  doc.text("DISCLAIMER & LEGAL NOTICE", ML + 3, disclaimerY + 6);
  hl(doc, ML + 3, disclaimerY + 8.5, PW - MR - 3, disclaimerY + 8.5, C.DIV, 0.25);

  doc.setFont("helvetica", "normal"); doc.setFontSize(5.9); tc(doc, C.BODY);
  doc.text(disclaimerLines, ML + 3, disclaimerY + 12);

  const addInfoY = disclaimerY + disclaimerH + 7;
  if (addInfoY + 22 < PH - 16) {
    fc(doc, C.P_LITE);
    doc.roundedRect(ML, addInfoY, PW - ML - MR, 22, 2.5, 2.5, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(7); tc(doc, C.P);
    doc.text("ADDITIONAL INFORMATION", ML + 3, addInfoY + 6);
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.1); tc(doc, C.BODY);
    const addLines = doc.splitTextToSize("Additional information regarding MINT's investment strategies — including strategy descriptions, risk disclosures, fee schedules, investment methodology, and portfolio construction framework — is available on request from MINT Platforms (Pty) Ltd. Contact us at: info@mymint.co.za  ·  +27 10 276 0531  ·  www.mymint.co.za  ·  3 Gwen Lane, Sandown, Sandton, Johannesburg.", PW - ML - MR - 8);
    doc.text(addLines, ML + 3, addInfoY + 11.5);
  }

  const FY = PH - 12;
  fc(doc, C.P); doc.rect(0, FY, PW, 12, "F");
  fc(doc, C.P_MID); doc.rect(0, FY, PW, 1.2, "F");
  await drawMintLogo(doc, ML, FY + 2.4, 4.5);
  doc.setFont("helvetica", "normal"); doc.setFontSize(5.8); tc(doc, [185,160,225]);
  doc.text(`${name}  ·  Disclosures & Risk Factors  ·  ${monthStr}`, ML + 28, FY + 5.5);
  doc.setFont("helvetica", "normal"); doc.setFontSize(5); tc(doc, [160,130,205]);
  doc.text("MINT (Pty) Ltd · Authorised FSP 55118 · FSCA Regulated · Registered Credit Provider NCRCP22892 · © 2026 MINT. All rights reserved.", ML, FY + 9.8);
  tc(doc, [160,140,200]);
  doc.text("Page 2 of 2", PW - MR, FY + 4.2, { align: "right" });
  doc.text(`Generated ${isoDate}`, PW - MR, FY + 9.8, { align: "right" });
}

export default async function generateFactsheetPdf({
  strategy,
  analytics,
  holdingsWithMetrics,
  userPosition,
  calculatedMinInvestment,
  performanceData,
  timeframeReturns,
  feeRates = {},
  preOpenedWindow = null,
}) {
  // Resolve live fee values — fall back to conservative defaults only if not provided
  const _brokerPct  = +((feeRates.BROKER_FEE_RATE             ?? 0.0025) * 100).toFixed(3);
  const _walletPct  = +((feeRates.WALLET_TRANSACTION_FEE_RATE ?? 0.01)   * 100).toFixed(2);
  const _ozowPct    = +((feeRates.OZOW_TRANSACTION_FEE_RATE   ?? 0.038)  * 100).toFixed(2);
  const _custodyAmt = +(feeRates.ISIN_FEE_PER_ASSET            ?? 69);
  const _aumPct     = +((feeRates.AUM_FEE_RATE                ?? 0.0099) * 100).toFixed(2);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  doc.setProperties({ title: `${strategy?.name || "Strategy"} Factsheet`, subject: "MINT Strategy Factsheet", author: "MINT Platforms (Pty) Ltd" });

  const name = strategy?.name || "Strategy";
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
  const monthStr = now.toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
  const isoDate = now.toISOString().split("T")[0];

  // ── SECTOR ALLOCATION ─────────────────────────────────────────────────────
  // holdingsWithMetrics now carries h.sector forwarded from the securities
  // table, so the pie chart will reflect real sectors instead of "Other 100%".
  const holdings = (holdingsWithMetrics || []).filter(h => String(h.symbol || "").toUpperCase() !== "CASH");
  const sectorMap = {};
  const _totalW = holdings.reduce((s, h) => s + (h.weightNorm != null ? h.weightNorm * 100 : +h.weight || 0), 0) || 100;
  holdings.forEach(h => {
    const rawWt = h.weightNorm != null ? h.weightNorm * 100 : +h.weight || 0;
    const normWt = (rawWt / _totalW) * 100;
    const sector = h.sector ?? h.gics_sector ?? h.industry ?? h.asset_class ?? "Other";
    sectorMap[sector] = (sectorMap[sector] || 0) + normWt;
  });
  let sectorSlices = Object.entries(sectorMap).map(([name, pct]) => ({ name, pct: +pct.toFixed(2) })).sort((a, b) => b.pct - a.pct).slice(0, 8);
  const _sliceTotal = sectorSlices.reduce((s, sl) => s + sl.pct, 0);
  if (_sliceTotal > 0) sectorSlices = sectorSlices.map(sl => ({ ...sl, pct: +((sl.pct / _sliceTotal) * 100).toFixed(1) }));

  // HEADER
  fc(doc, C.P); doc.rect(0, 0, PW, HDR, "F");
  fc(doc, C.P_MID); doc.rect(0, 0, PW, 1.8, "F");
  fc(doc, C.P_MID); doc.rect(0, HDR, PW, 0.7, "F");
  await drawMintLogo(doc, PW - MR - 8 * CONFIG.LOGO_ASPECT, (HDR - 8) / 2, 8);

  doc.setFont("helvetica", "bold"); doc.setFontSize(8); tc(doc, C.WHITE);
  doc.text("MINT STRATEGY FACTSHEET", ML, 11);
  hl(doc, ML, 14, ML + 85, 14);

  doc.setFont("helvetica", "bold"); doc.setFontSize(7.2); tc(doc, C.WHITE);
  doc.text(name, ML, 19, { maxWidth: PW - MR - 8 * CONFIG.LOGO_ASPECT - ML - 6 });

  doc.setFont("helvetica", "normal"); doc.setFontSize(5.3); tc(doc, [160,130,210]);
  doc.text(`STRATEGY FACTSHEET  ·  ${dateStr}`, ML, 24);

  doc.setFont("helvetica", "normal"); doc.setFontSize(4.5); tc(doc, [185,155,230]);
  doc.text(
    "MINT (Pty) Ltd · Authorised FSP 55118 · FSCA Regulated · Registered Credit Provider NCRCP22892 · © 2026 MINT. All rights reserved.",
    ML, 28,
    { maxWidth: PW - MR - 8 * CONFIG.LOGO_ASPECT - ML - 4 }
  );

  let ly = HDR + 7;
  let ry = HDR + 7;

  // ── LEFT COLUMN ──────────────────────────────────────────────────────────────

  ly = secHead(doc, "Investment Objective", ML, ly, LW) + 2;
  const objective = strategy?.objective || strategy?.description || "Investment objective not available.";
  doc.setFont("helvetica", "normal"); doc.setFontSize(7); tc(doc, C.BODY);
  const objLines = doc.splitTextToSize(objective, LW - 2);
  doc.text(objLines, ML, ly);
  ly += objLines.length * 3.3 + 5;

  ly = secHead(doc, "Cumulative Performance", ML, ly, LW) + 3;
  const curves = analytics?.curves || {};
  const longestKey = ["YTD","6M","3M","1M","1W"].find(k => Array.isArray(curves[k]) && curves[k].length > 1);
  drawChart(doc, longestKey ? curves[longestKey] : [], ML, ly, LW, 47);
  ly += 52;

  ly = secHead(doc, "Return Analysis", ML, ly, LW) + 3;
  const summary = analytics?.summary || {};
  const ytdVal = summary.ytd_return ?? analytics?.ytd_return;
  const retRows = [
    ["5 Days",   fmtPct(timeframeReturns?.["5D"])],
    ["30 Days",  fmtPct(timeframeReturns?.["1M"])],
    ["90 Days",  fmtPct(performanceData?.threeMonthReturn)],
    ["6 Months", fmtPct(timeframeReturns?.["6M"])],
    ["YTD",      fmtPct(timeframeReturns?.["YTD"] ?? ytdVal)],
    ["All-time", fmtPct(timeframeReturns?.["ALL"])],
  ];

  autoTable(doc, {
    startY: ly,
    margin: { left: ML, right: PW - ML - LW },
    head: [["Period", "Return"]],
    body: retRows,
    theme: "plain",
    styles: { fontSize: 7.1, cellPadding: 2.4, textColor: C.DARK, lineColor: C.DIV, lineWidth: 0.15 },
    headStyles: { fillColor: C.P, textColor: C.WHITE, fontStyle: "bold", fontSize: 6.8, cellPadding: 2.4 },
    alternateRowStyles: { fillColor: C.P_PALE },
    columnStyles: { 0: { cellWidth: 34, fontStyle: "bold" }, 1: { cellWidth: 33, halign: "right" } },
    tableWidth: 68,
    didParseCell: d => pctHook(d, 1),
  });
  ly = doc.lastAutoTable.finalY + 6;

  ly = secHead(doc, "Risk Analysis", ML, ly, LW) + 3;
  const riskRows = [
    ["Best Day",         fmtPct(performanceData?.bestDay  != null ? performanceData.bestDay  / 100 : summary.best_day)],
    ["Worst Day",        fmtPct(performanceData?.worstDay != null ? performanceData.worstDay / 100 : summary.worst_day)],
    ["Avg Daily Return", fmtPct(performanceData?.avgDaily != null ? performanceData.avgDaily / 100 : summary.avg_day)],
    ["YTD Return",       fmtPct(timeframeReturns?.["YTD"] ?? (performanceData?.ytdReturn != null ? performanceData.ytdReturn / 100 : null) ?? ytdVal)],
  ];
  if (summary.max_drawdown != null)        riskRows.push(["Max Drawdown",      fmtPct(summary.max_drawdown)]);
  if (summary.volatility != null)          riskRows.push(["Volatility (Ann.)", fmtPct(summary.volatility)]);
  if (summary.sharpe_ratio != null)        riskRows.push(["Sharpe Ratio",      (+summary.sharpe_ratio).toFixed(2)]);
  if (summary.pct_positive_months != null) riskRows.push(["% +ve Months",      `${(+summary.pct_positive_months * 100).toFixed(1)}%`]);

  autoTable(doc, {
    startY: ly,
    margin: { left: ML, right: PW - ML - LW },
    head: [["Metric", "Value"]],
    body: riskRows,
    theme: "plain",
    styles: { fontSize: 7.1, cellPadding: 2.4, textColor: C.DARK, lineColor: C.DIV, lineWidth: 0.15 },
    headStyles: { fillColor: C.P, textColor: C.WHITE, fontStyle: "bold", fontSize: 6.8, cellPadding: 2.4 },
    alternateRowStyles: { fillColor: C.P_PALE },
    columnStyles: { 0: { cellWidth: 38, fontStyle: "bold" }, 1: { cellWidth: 29, halign: "right" } },
    tableWidth: 68,
    didParseCell: d => pctHook(d, 1),
  });

  const leftBottomY = doc.lastAutoTable.finalY;

  // ── RIGHT COLUMN ─────────────────────────────────────────────────────────────

  const LX = RX + 3;
  const VX = RX + RW - 3;
  const ROW = 6.4;

  const detailData = [
    ["Risk Profile",    strategy?.risk_level || "—"],
    ["Manager",         strategy?.provider_name || "MINT Investments"],
    ["NAV Index",       analytics?.latest_value != null ? (+analytics.latest_value / 100).toFixed(4) : "—"],
    ["Inception",       strategy?.created_at ? new Date(strategy.created_at).toLocaleDateString("en-ZA",{month:"short",year:"numeric"}) : "—"],
    ["Benchmark",       strategy?.benchmark_name || "JSE All Share"],
    ["Min Investment",  calculatedMinInvestment ? fmtR(calculatedMinInvestment) : (strategy?.min_investment ? fmtR(strategy.min_investment) : "—")],
    ["Currency",        strategy?.base_currency || "ZAR"],
  ];

  const detailCardH = 5 + 6 + detailData.length * ROW + 4;
  fc(doc, C.P_LITE); doc.roundedRect(RX, ry, RW, detailCardH, 2.5, 2.5, "F");
  fc(doc, C.P); doc.roundedRect(RX, ry, RW, 5, 2.5, 2.5, "F");
  ry = subHead(doc, "Strategy Details", LX, ry + 7.5, RW - 6) + 1;

  detailData.forEach(([label, value], i) => {
    if (i % 2 === 0) { fc(doc, C.P_STRIPE); doc.rect(LX - 1, ry - 1.8, RW - 4, ROW, "F"); }
    doc.setFontSize(6.3); doc.setFont("helvetica", "normal"); tc(doc, C.P_DIM);
    doc.text(label, LX, ry + 2.4);
    doc.setFont("helvetica", "bold"); tc(doc, C.DARK);
    const v = String(value ?? "—");
    doc.text(v.length > 18 ? v.slice(0, 18) + "…" : v, VX, ry + 2.4, { align: "right" });
    ry += ROW;
  });
  ry += 8;

  const feesData = [
    ["Transaction Fee (Wallet/EFT)", `${_walletPct}% / trade`],
    ["Transaction Fee (Ozow)",       `${_ozowPct}% / trade`],
    ["Broker Fee",                   `${_brokerPct}% / trade`],
    ["AUM Fee",                      `${_aumPct}% p.a.`],
    ["Custody fee (per asset)",      `R${_custodyAmt} / asset`],
  ];

  const feesCardH = 5 + 6 + feesData.length * ROW + 3;
  fc(doc, C.P_LITE); doc.roundedRect(RX, ry, RW, feesCardH, 2.5, 2.5, "F");
  fc(doc, C.P_MID); doc.roundedRect(RX, ry, RW, 5, 2.5, 2.5, "F");
  ry = subHead(doc, "Fees & Charges", LX, ry + 7.5, RW - 6) + 1;

  feesData.forEach(([label, value], i) => {
    if (i % 2 === 0) { fc(doc, C.P_STRIPE); doc.rect(LX - 1, ry - 1.8, RW - 4, ROW, "F"); }
    doc.setFontSize(6.3); doc.setFont("helvetica", "normal"); tc(doc, C.P_DIM);
    doc.text(label, LX, ry + 2.4);
    doc.setFont("helvetica", "bold"); tc(doc, C.DARK);
    doc.text(value, VX, ry + 2.4, { align: "right" });
    ry += ROW;
  });
  ry += 9;

  ry = subHead(doc, "Sector Allocation", LX, ry, RW - 6) + 3.5;
  const PIE_R = 13.5;
  const PIE_CX = RX + RW / 2;
  const PIE_CY = ry + PIE_R + 1;
  ry = drawPieChart(doc, sectorSlices, PIE_CX, PIE_CY, PIE_R) + 4;

  ry = subHead(doc, "Portfolio Holdings", LX, ry, RW - 6) + 2.5;

  const holdRows = (holdingsWithMetrics || [])
    .filter(h => String(h.symbol || "").toUpperCase() !== "CASH")
    .slice(0, 10)
    .map(h => {
      const wt = h.weightNorm != null ? (h.weightNorm * 100).toFixed(1) : (+h.weight || 0).toFixed(1);
      const chg = h.change_pct != null ? fmtPct(+h.change_pct / 100) : "—";
      return [h.symbol || "—", `${wt}%`, chg];
    });

  if (holdRows.length) {
    autoTable(doc, {
      startY: ry,
      margin: { left: RX, right: MR },
      head: [["Ticker", "Wt", "Chg"]],
      body: holdRows,
      theme: "plain",
      styles: { fontSize: 6.1, cellPadding: 1.8, textColor: C.DARK, lineColor: C.DIV, lineWidth: 0.12 },
      headStyles: { fillColor: C.P, textColor: C.WHITE, fontStyle: "bold", fontSize: 5.9, cellPadding: 2 },
      alternateRowStyles: { fillColor: C.P_PALE },
      columnStyles: { 0: { cellWidth: RW * 0.39, fontStyle: "bold" }, 1: { cellWidth: RW * 0.29, halign: "right" }, 2: { cellWidth: RW * 0.29, halign: "right" } },
      tableWidth: RW - 2,
      didParseCell: d => pctHook(d, 2),
    });
    ry = doc.lastAutoTable.finalY + 6;
  }

  // ── YOUR INVESTMENT ───────────────────────────────────────────────────────────

  if (userPosition?.invested > 0) {
    const posData = [
      ["Amount Invested", fmtR(userPosition.invested)],
      ["Current Value",   fmtR(userPosition.currentValue)],
      ["Return",          userPosition.returnPct != null ? fmtPct(userPosition.returnPct) : "N/A"],
    ];
    const posCardH = 5 + 6 + posData.length * ROW + 3;
    fc(doc, C.P_LITE); doc.roundedRect(RX, ry, RW, posCardH, 2.5, 2.5, "F");
    fc(doc, C.P); doc.roundedRect(RX, ry, RW, 5, 2.5, 2.5, "F");
    ry = subHead(doc, "Your Investment", LX, ry + 7.5, RW - 6) + 1;

    posData.forEach(([label, value]) => {
      const isPos = label === "Return" && value.startsWith("+");
      const isNeg = label === "Return" && value.startsWith("-");
      doc.setFontSize(6.3); doc.setFont("helvetica", "normal"); tc(doc, C.P_DIM);
      doc.text(label + ":", LX, ry + 2.4);
      doc.setFont("helvetica", "bold"); tc(doc, isPos ? C.GREEN : isNeg ? C.RED : C.DARK);
      doc.text(value, VX, ry + 2.4, { align: "right" });
      ry += ROW;
    });
  }

  // ── KEY DISCLOSURES STRIP ────────────────────────────────────────────────────

  const DISC_TOP = Math.max(leftBottomY, ry) + 9;
  const DISC_COLW = (PW - ML - MR - 8) / 2;
  const DISC_RX = ML + DISC_COLW + 8;

  const summaryDiscItems = [
    { title: "Regulatory Status", body: "MINT Platforms (Pty) Ltd (Reg. 2024/644796/07) trading as MINT, 3 Gwen Lane, Sandown, Sandton. Strategies are not collective investment schemes unless explicitly stated. Not financial advice under FAIS Act No. 37 of 2002. Seek independent advice prior to investing." },
    { title: "Custody & Asset Segregation", body: "Client assets are held via an appointed Central Securities Depository Participant (CSDP) through its appointed nominee custodian. Assets are fully segregated from MINT's own assets at all times." },
    { title: "Performance Disclosure", body: "Performance may include historical or back-tested results. Back-tested performance does not represent actual trading and is constructed with hindsight. Performance is gross of fees unless stated. Individual returns may differ based on timing, costs, and taxes." },
    { title: "Risk Warning", body: "Past performance does not guarantee future results. Capital is not guaranteed. Strategies are subject to Market, Equity, Volatility, Leverage, Liquidity, Counterparty, Concentration, and Foreign Market risks. See Page 2 for full risk factor disclosures." },
    { title: "Fees Summary", body: `Transaction fee: ${_walletPct}% per trade (wallet/EFT), ${_ozowPct}% (Ozow). Broker fee: ${_brokerPct}% per trade. Custody: R${_custodyAmt} per asset (shown at checkout). AUM fee: ${_aumPct}% per annum, accrued daily and settled monthly from the cash sleeve. No performance fee. Full fee schedule available on request.` },
    { title: "Full Disclosures", body: "Complete regulatory disclosures, risk factors, legal notices, and the full disclaimer are contained on Page 2 of this factsheet. Please read all disclosures carefully before investing." },
  ];

  doc.setFontSize(6.1);
  const measured = summaryDiscItems.map(d => ({ ...d, lines: doc.splitTextToSize(d.body, DISC_COLW) }));
  const leftH = measured.slice(0, 3).reduce((s, m) => s + 4.5 + m.lines.length * 2.65 + 4, 0);
  const rightH = measured.slice(3).reduce((s, m) => s + 4.5 + m.lines.length * 2.65 + 4, 0);
  const DISC_H = Math.max(leftH, rightH) + 18;
  const FOOTER_TOP = PH - 12;
  const availH = FOOTER_TOP - DISC_TOP - 5;

  fc(doc, C.P_PALE); doc.rect(0, DISC_TOP, PW, Math.min(DISC_H, availH), "F");
  fc(doc, C.P); doc.rect(0, DISC_TOP, PW, 3.2, "F");

  doc.setFont("helvetica", "bold"); doc.setFontSize(7.2); tc(doc, C.P);
  doc.text("KEY DISCLOSURES & RISK SUMMARY  ·  Full details on Page 2", ML, DISC_TOP + 9.5);

  let dly = DISC_TOP + 15;
  let dry = DISC_TOP + 15;
  measured.forEach((item, i) => {
    const isRight = i >= 3;
    const x = isRight ? DISC_RX : ML;
    let y = isRight ? dry : dly;
    if (y + 6 >= FOOTER_TOP - 4) return;
    doc.setFont("helvetica", "bold"); doc.setFontSize(6.1); tc(doc, C.P_MID);
    doc.text(item.title, x, y);
    y += 4.5;
    doc.setFont("helvetica", "normal"); tc(doc, C.BODY);
    doc.text(item.lines, x, y);
    y += item.lines.length * 2.65 + 4;
    if (isRight) dry = y; else dly = y;
  });

  // ── FOOTER ───────────────────────────────────────────────────────────────────

  fc(doc, C.P); doc.rect(0, FOOTER_TOP, PW, 12, "F");
  fc(doc, C.P_MID); doc.rect(0, FOOTER_TOP, PW, 1.2, "F");
  await drawMintLogo(doc, ML, FOOTER_TOP + 2.4, 4.5);
  doc.setFont("helvetica", "normal"); doc.setFontSize(5.9); tc(doc, [185,160,225]);
  doc.text(`${name}  ·  Strategy Factsheet  ·  ${monthStr}`, ML + 28, FOOTER_TOP + 5.6);
  doc.setFont("helvetica", "normal"); doc.setFontSize(5); tc(doc, [160,130,205]);
  doc.text("MINT (Pty) Ltd · Authorised FSP 55118 · FSCA Regulated · Registered Credit Provider NCRCP22892 · © 2026 MINT. All rights reserved.", ML, FOOTER_TOP + 9.8);
  tc(doc, [160,140,200]);
  doc.text("Page 1 of 2", PW - MR, FOOTER_TOP + 4.2, { align: "right" });
  doc.text(`Generated ${isoDate}`, PW - MR, FOOTER_TOP + 9.8, { align: "right" });

  await addDisclosurePage(doc, name, dateStr, monthStr, isoDate, feeRates);

  // ── OUTPUT ───────────────────────────────────────────────────────────────────

  const pdfFilename = `${name.replace(/[^a-zA-Z0-9]/g, "_")}_Factsheet_${isoDate}.pdf`;
  try {
    const pdfBlob = doc.output("blob");
    const blobUrl = URL.createObjectURL(pdfBlob);

    if (preOpenedWindow && !preOpenedWindow.closed) {
      preOpenedWindow.location.href = blobUrl;
      setTimeout(() => URL.revokeObjectURL(blobUrl), 300000);
      return;
    }

    const newTab = window.open(blobUrl, "_blank");
    if (newTab && !newTab.closed) {
      setTimeout(() => URL.revokeObjectURL(blobUrl), 300000);
      return;
    }

    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = pdfFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 300000);
  } catch (err) {
    console.error(err);
    alert("PDF generation failed. Please try again.");
    doc.save(pdfFilename);
  }
}
