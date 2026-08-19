#!/usr/bin/env python3
"""ESP32 IDE Bug 修复验收方案生成器"""

from dataclasses import dataclass, field
from typing import List
from datetime import datetime, timedelta

@dataclass
class Task:
    name: str
    description: str
    effort_hours: int
    dependencies: List[str] = field(default_factory=list)
    acceptance_criteria: List[str] = field(default_factory=list)

@dataclass
class Phase:
    name: str
    goal: str
    tasks: List[Task] = field(default_factory=list)
    risks: List[str] = field(default_factory=list)

@dataclass
class Plan:
    title: str
    goal: str
    phases: List[Phase] = field(default_factory=list)
    created: str = ""

    def __post_init__(self):
        if not self.created:
            self.created = datetime.now().strftime("%Y-%m-%d %H:%M")

    def add_phase(self, name, goal) -> Phase:
        p = Phase(name=name, goal=goal)
        self.phases.append(p)
        return p

    def total_effort(self) -> int:
        return sum(t.effort_hours for p in self.phases for t in p.tasks)

    def markdown(self) -> str:
        lines = [
            f"# {self.title}",
            "",
            f"**目标**: {self.goal}",
            f"**总工作量**: {self.total_effort()} 人时",
            f"**创建时间**: {self.created}",
            "",
            "> **核心原则**: 每阶段完成 → 验收测试 → 确认无 bug → 再进入下一阶段",
            "",
            "## Bug 总览",
            "- P0 数据丢失: 5 项（必须修）",
            "- P1 稳定性: 7 项（高优先）",
            "- P2 功能缺陷: 6 项",
            "- P3 UX/安全: 7 项",
            "",
        ]

        for pi, phase in enumerate(self.phases):
            lines.append("---")
            lines.append(f"## Phase {pi+1}: {phase.name}")
            lines.append(f"**目标**: {phase.goal}")
            if phase.risks:
                for r in phase.risks:
                    lines.append(f"- ⚠️ {r}")
            lines.append("")

            for ti, task in enumerate(phase.tasks):
                lines.append(f"### {pi+1}.{ti+1} {task.name}")
                lines.append(f"- **描述**: {task.description}")
                lines.append(f"- **工作量**: {task.effort_hours}h")
                if task.dependencies:
                    lines.append(f"- **前置依赖**: {', '.join(task.dependencies)}")
                if task.acceptance_criteria:
                    lines.append("- **验收标准**:")
                    for ac in task.acceptance_criteria:
                        lines.append(f"  - [ ] {ac}")
                lines.append("")

        return "\n".join(lines)


plan = Plan(
    title="ESP32 IDE Bug 修复验收方案",
    goal="修复全部 25 项 Bug，确保数据安全、运行稳定、功能完整"
)

# ── Phase A: P0 数据丢失 ──
pA = plan.add_phase("P0 数据丢失修复", "消除所有数据丢失风险，确保用户代码安全")
pA.risks.append("自动保存频率过高可能影响性能")

pA.tasks.append(Task(
    "自动保存机制", "每 30 秒自动保存到 .autosave 文件，切换文件/编译前也触发",
    4, [],
    ["编辑器修改后 30 秒内自动保存", "切换文件前自动保存", "编译/烧录前自动保存", ".autosave 文件在项目目录下"]
))
pA.tasks.append(Task(
    "崩溃恢复", "启动时检测 .autosave，弹窗提示用户恢复",
    3, ["自动保存机制"],
    ["IDE 重启后弹窗提示'发现未保存的恢复文件'", "用户选择恢复后内容正确加载", "用户选择忽略后删除 .autosave"]
))
pA.tasks.append(Task(
    "IPC 超时保护", "给 get-editor-content-response 加 5 秒超时",
    2, [],
    ["保存操作 5 秒内无响应自动失败", "不阻塞 UI 线程", "失败后弹窗提示用户"]
))
pA.tasks.append(Task(
    "文件切换保存逻辑修复", "handleFileOpenFromTree 中 await saveFile 结果",
    1, ["IPC 超时保护"],
    ["切换文件时正确保存当前文件", "保存失败时不切换文件"]
))

# ── Phase B: P1 稳定性 ──
pB = plan.add_phase("P1 稳定性修复", "消除进程残留、引用过时、主线程阻塞等问题")
pB.risks.append("子进程清理需要跨模块协调")

pB.tasks.append(Task(
    "编译进程超时", "runPio 添加 10 分钟超时，超时自动 kill",
    2, [],
    ["编译超过 10 分钟自动终止", "超时后显示错误提示", "isBuilding 状态正确重置"]
))
pB.tasks.append(Task(
    "IDE 退出清理子进程", "app.on('before-quit') 中 kill 所有活跃进程",
    2, [],
    ["关闭 IDE 后 pio/gcc 进程不存在", "任务管理器无残留"]
))
pB.tasks.append(Task(
    "mainWindow 引用动态获取", "registerPioIpc/serial 改为闭包获取最新窗口",
    2, [],
    ["窗口重建后编译/串口功能正常", "不再使用注册时的旧引用"]
))
pB.tasks.append(Task(
    "目录列表异步化", "file-tree.js 改用 fs.promises.readdir + 分批处理",
    3, [],
    ["大项目文件树不卡 UI", "1000+ 文件项目响应时间 < 2 秒"]
))
pB.tasks.append(Task(
    "目录监听增强", "fs.watch 失败时 fallback 到 fs.watchFile",
    2, [],
    ["网络驱动下文件树仍能刷新", "监听失败不崩溃"]
))
pB.tasks.append(Task(
    "串口重连时序修复", "monitorPostUpload 保存端口+波特率到变量，不依赖渲染进程",
    2, [],
    ["烧录后自动重连正确的串口和波特率", "不出现重连错误端口"]
))

# ── Phase C: P2 功能缺陷 ──
pC = plan.add_phase("P2 功能缺陷修复", "修复串口检测、配置覆盖、日志内存等问题")

pC.tasks.append(Task(
    "串口检测改用 scan 模式", "checkPortAvailable 改为只查询不打开",
    2, [],
    ["检测串口占用时不抢占串口", "烧录和检测可同时进行"]
))
pC.tasks.append(Task(
    "platformio.ini 覆盖保护", "生成前检测是否已存在，存在则弹窗确认",
    1, [],
    ["已有 ini 时弹窗询问是否覆盖", "用户取消则不覆盖"]
))
pC.tasks.append(Task(
    "输出日志限制", "outputLines 最多保留 5000 行，超出自动截断",
    1, [],
    ["大项目编译后内存不爆", "最新的日志始终保留"]
))
pC.tasks.append(Task(
    "文件树目录过滤", "增加 .pio/.pioenvs/.piolibdeps 过滤",
    1, [],
    [".pio 构建目录不出现在文件树中"]
))
pC.tasks.append(Task(
    "build 闭包修复", "handleBuild/handleUpload 使用 ref 获取最新 projectPath",
    2, [],
    ["选择项目后立即编译不报错", "不需要重启 IDE"]
))

# ── Phase D: P3 UX/安全 ──
pD = plan.add_phase("P3 UX 与安全修复", "路径检测、编码支持、安全加固")

pD.tasks.append(Task(
    "中文路径检测", "启动时检测 app 路径和项目路径是否含中文/空格",
    1, [],
    ["路径含中文时弹窗警告", "建议用户移动到纯英文路径"]
))
pD.tasks.append(Task(
    "文件编码检测", "打开文件时尝试 UTF-8，失败则用 GBK 解码",
    2, [],
    ["GBK 文件正确显示中文", "保存时保持原编码"]
))
pD.tasks.append(Task(
    "preload 安全加固", "移除 fileWrite，改为只通过 save-file 保存",
    1, [],
    ["渲染进程无法直接写任意文件", "文件保存只能通过菜单/快捷键"]
))
pD.tasks.append(Task(
    "deleteItem 异常处理", "file-tree.js deleteItem 添加 try/catch",
    0.5, [],
    ["删除失败不崩溃，返回错误信息"]
))
pD.tasks.append(Task(
    "串口监视器时间戳", "每条数据前显示 HH:MM:SS.mmm 时间戳",
    1, [],
    ["接收数据显示时间戳", "时间戳可选开关"]
))

output = plan.markdown()
print(output)

with open("/home/pi/.openclaw/workspace/esp32-ide/BUG-FIX-PLAN.md", "w") as f:
    f.write(output)

print(f"\n--- 修复方案已保存到 BUG-FIX-PLAN.md ---")
print(f"总工作量: {plan.total_effort()} 人时")
