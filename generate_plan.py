#!/usr/bin/env python3
"""ESP32 便捷 IDE - 实现计划生成器 (基于 laosi-write-plan 框架)"""

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

    def add_phase(self, name: str, goal: str) -> Phase:
        p = Phase(name=name, goal=goal)
        self.phases.append(p)
        return p

    def verify_dependencies(self) -> List[str]:
        warnings = []
        all_tasks = {}
        for pi, phase in enumerate(self.phases):
            for task in phase.tasks:
                all_tasks[task.name] = pi
        for pi, phase in enumerate(self.phases):
            for task in phase.tasks:
                for dep in task.dependencies:
                    dep_phase = all_tasks.get(dep)
                    if dep_phase is None:
                        warnings.append(f"⚠️ {task.name} 依赖 '{dep}' 但该任务不存在")
                    elif dep_phase > pi:
                        warnings.append(f"⚠️ {task.name} 依赖 Phase{dep_phase+1} 的 '{dep}'，但它在更后面")
        return warnings

    def total_effort(self) -> int:
        return sum(t.effort_hours for p in self.phases for t in p.tasks)

    def estimate_delivery(self, hours_per_day: int = 6) -> str:
        days = self.total_effort() / hours_per_day
        delivery = datetime.now() + timedelta(days=days)
        return delivery.strftime("%Y-%m-%d")

    def markdown(self) -> str:
        lines = [
            f"# {self.title}",
            "",
            f"**目标**: {self.goal}",
            f"**总工作量**: {self.total_effort()} 人时",
            f"**预计交付**: {self.estimate_delivery()}（按每天 6 小时计算）",
            f"**创建时间**: {self.created}",
            "",
            "> **核心原则**: 每阶段完成 → 验收测试 → 确认无 bug → 再进入下一阶段",
            "",
        ]

        # 阶段依赖总览
        lines.append("## 阶段依赖关系")
        lines.append("```")
        for pi, phase in enumerate(self.phases):
            if pi < len(self.phases) - 1:
                lines.append(f"Phase {pi+1}: {phase.name}")
                lines.append("   ↓ 验收通过")
            else:
                lines.append(f"Phase {pi+1}: {phase.name}")
        lines.append("```")
        lines.append("")

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

        # 依赖检查
        warnings = self.verify_dependencies()
        if warnings:
            lines.append("## ⚠️ 依赖警告")
            for w in warnings:
                lines.append(f"- {w}")
            lines.append("")

        # 验收流程
        lines.append("---")
        lines.append("## 验收流程")
        lines.append("""
每个阶段完成后：
1. 开发者自测全部验收项，截图/录屏
2. 提交验收报告（通过/不通过 + 问题清单）
3. 不通过的问题修复后，重新验收
4. 全部通过后，git commit + 打 tag，进入下一阶段
""")
        return "\n".join(lines)


# ============================================================
# 构建 ESP32 IDE 计划
# ============================================================

plan = Plan(
    title="ESP32 便捷 IDE 实施计划",
    goal="做一个面向国内新手的 ESP32 IDE，开箱即用、离线可用、零配置编译烧录"
)

# ------ Phase 1 ------
p1 = plan.add_phase("Electron 脚手架 + 编辑器基础", "跑起来一个 Electron 应用，能打开、编辑、保存代码文件")
p1.risks.append("Electron 首次启动可能被杀软误报，需提前准备白名单")

p1.tasks.append(Task(
    "Electron 项目初始化", "Vite + React + Electron 脚手架搭建",
    4, [],
    ["项目可 npm run dev 启动", "窗口 3 秒内显示，无白屏"]
))
p1.tasks.append(Task(
    "Monaco Editor 集成", "嵌入 Monaco Editor，配置 C/C++ 语言支持",
    6, ["Electron 项目初始化"],
    ["代码有语法高亮", "括号匹配", "行号显示"]
))
p1.tasks.append(Task(
    "基础菜单栏", "文件菜单：新建/打开/保存/另存为/退出",
    3, ["Electron 项目初始化"],
    ["Ctrl+N 新建空白文件", "Ctrl+O 打开 .c/.cpp/.h 文件", "Ctrl+S 保存", "Ctrl+Shift+S 另存为"]
))
p1.tasks.append(Task(
    "窗口标题与状态", "标题栏显示当前文件名和编辑状态",
    1, ["基础菜单栏"],
    ["未保存时标题带 * 号", "新建文件显示 '未命名'"]
))
p1.tasks.append(Task(
    "暗色主题", "编辑器 + UI 暗色主题样式",
    2, ["Monaco Editor 集成"],
    ["编辑器背景深色，文字清晰可读", "与 VS Code 暗色主题风格接近"]
))
p1.tasks.append(Task(
    "Phase 1 验收测试", "自测全部 9 项验收标准，截图录屏",
    2, ["暗色主题"],
    ["全部 9 项通过", "连续操作 10 分钟无闪退"]
))

# ------ Phase 2 ------
p2 = plan.add_phase("PlatformIO 集成 + 编译功能", "能在 IDE 内一键编译 ESP32-S3 项目")
p2.risks.append("PlatformIO 嵌入 Electron 可能有兼容性问题，需 POC 验证")
p2.risks.append("编译大项目时可能内存占用过高")

p2.tasks.append(Task(
    "PlatformIO 调用封装", "Node.js child_process 封装 pio 命令",
    6, ["Electron 项目初始化"],
    ["可调用 pio run", "可调用 pio run -t clean", "输出实时推送到前端"]
))
p2.tasks.append(Task(
    "platformio.ini 自动生成", "根据芯片选择自动生成配置文件",
    3, ["PlatformIO 调用封装"],
    ["选择 ESP32-S3 后生成正确的 ini", "board/framework/monitor_speed 正确"]
))
p2.tasks.append(Task(
    "编译按钮与输出面板", "UI 编译按钮 + 底部日志输出面板",
    4, ["PlatformIO 调用封装", "Monaco Editor 集成"],
    ["点击编译后按钮变灰", "日志实时滚动不卡顿", "编译完成后按钮恢复"]
))
p2.tasks.append(Task(
    "编译错误跳转", "解析编译错误输出，点击行号跳转到代码",
    4, ["编译按钮与输出面板"],
    ["错误信息包含行号", "点击行号光标跳转到对应代码行"]
))
p2.tasks.append(Task(
    "编译成功/失败状态", "状态栏显示编译结果，弹窗提示",
    2, ["编译按钮与输出面板"],
    ["成功显示绿色 ✓ SUCCESS", "失败显示红色 ✗ FAILED"]
))
p2.tasks.append(Task(
    "Phase 2 验收测试", "用 Blink 模板走完整编译流程",
    3, ["编译成功/失败状态"],
    ["全部 10 项通过", "Blink 项目编译 < 60 秒"]
))

# ------ Phase 3 ------
p3 = plan.add_phase("烧录功能", "能一键烧录到 ESP32-S3 开发板")
p3.risks.append("串口驱动（CH340/CP2102）需用户自行安装")
p3.risks.append("不同开发板烧录引脚/模式可能不同")

p3.tasks.append(Task(
    "串口自动检测", "扫描系统可用 COM 口并显示在下拉菜单",
    4, ["PlatformIO 调用封装"],
    ["连接开发板后自动显示串口", "刷新按钮重新扫描"]
))
p3.tasks.append(Task(
    "烧录按钮与流程", "点击烧录 → 调用 pio run -t upload",
    4, ["串口自动检测", "platformio.ini 自动生成"],
    ["烧录成功后开发板 LED 闪烁", "烧录过程显示进度", "未连接时提示错误"]
))
p3.tasks.append(Task(
    "烧录前自动编译", "修改代码后直接烧录时自动先编译",
    2, ["烧录按钮与流程"],
    ["修改后点烧录，自动先编译再烧录"]
))
p3.tasks.append(Task(
    "串口占用检测", "烧录时检测串口是否被其他程序占用",
    2, ["烧录按钮与流程"],
    ["被占用时提示'串口被占用，是否释放'"]
))
p3.tasks.append(Task(
    "Phase 3 验收测试", "拿 ESP32-S3 开发板走完整流程",
    3, ["串口占用检测"],
    ["全部 10 项通过", "从零新建→编译→烧录→LED 闪烁"]
))

# ------ Phase 4 ------
p4 = plan.add_phase("串口监视器", "能在 IDE 内查看串口输出、发送数据")
p4.risks.append("串口断开重连时可能丢失数据")

p4.tasks.append(Task(
    "串口监视器面板", "底部 tab，与编译输出共用区域",
    4, ["串口自动检测"],
    ["可切换编译输出/串口监视器", "波特率选择下拉"]
))
p4.tasks.append(Task(
    "实时数据接收", "通过 serialport 库接收串口数据并显示",
    4, ["串口监视器面板"],
    ["数据实时显示不丢失", "支持 UTF-8 显示", "自动滚动到底部"]
))
p4.tasks.append(Task(
    "数据发送", "输入框输入文字 + 回车发送",
    2, ["实时数据接收"],
    ["输入文字回车后开发板收到", "支持发送空行"]
))
p4.tasks.append(Task(
    "HEX 显示切换", "支持 ASCII/HEX 显示模式切换",
    2, ["实时数据接收"],
    ["切换 HEX 后数据显示为十六进制"]
))
p4.tasks.append(Task(
    "清屏与滚动控制", "清屏按钮 + 自动滚动开关",
    1, ["实时数据接收"],
    ["清屏后历史数据清除", "关闭自动滚动后新数据不强制滚底"]
))
p4.tasks.append(Task(
    "与烧录共存", "串口监视器打开时烧录功能正常",
    2, ["数据发送", "烧录按钮与流程"],
    ["烧录时自动断开串口→烧录→自动重连"]
))
p4.tasks.append(Task(
    "Phase 4 验收测试", "开发板跑 echo 程序，收发测试",
    3, ["与烧录共存"],
    ["全部 10 项通过"]
))

# ------ Phase 5 ------
p5 = plan.add_phase("项目管理 + 模板", "新手友好，一键创建项目，文件管理清晰")
p5.risks.append("模板内容需后续持续维护更新")

p5.tasks.append(Task(
    "文件树面板", "左侧显示项目目录结构",
    3, ["Electron 项目初始化"],
    ["正确显示 .c/.cpp/.h 文件", "可折叠展开"]
))
p5.tasks.append(Task(
    "新建项目向导", "选芯片 → 选模板 → 命名 → 生成项目",
    5, ["文件树面板", "platformio.ini 自动生成"],
    ["向导走完生成完整目录", "platformio.ini 内容正确"]
))
p5.tasks.append(Task(
    "Blink 模板", "LED 闪烁模板代码",
    1, ["新建项目向导"],
    ["编译通过", "烧录后 LED 闪烁"]
))
p5.tasks.append(Task(
    "WiFi Scanner 模板", "扫描周围 WiFi 热点",
    2, ["新建项目向导"],
    ["编译通过", "烧录后串口输出 AP 列表"]
))
p5.tasks.append(Task(
    "Serial Echo 模板", "串口回显程序",
    1, ["新建项目向导"],
    ["编译通过", "串口收发正常"]
))
p5.tasks.append(Task(
    "文件操作", "右键新建/删除/重命名文件",
    3, ["文件树面板"],
    ["新建 .c 文件后编译识别", "删除后编译不再包含", "重命名后内容不变"]
))
p5.tasks.append(Task(
    "Phase 5 验收测试", "从零创建项目走全流程",
    3, ["文件操作"],
    ["全部 10 项通过"]
))

# ------ Phase 6 ------
p6 = plan.add_phase("打包发布", "打包成 Windows 离线安装包，国内可下载")
p6.risks.append("包体可能超过 500MB，需压缩优化")
p6.risks.append("杀软可能误报，需代码签名证书")

p6.tasks.append(Task(
    "工具链离线打包", "预装 PlatformIO + ESP32 工具链到应用目录",
    6, [],
    ["断网状态下 pio run 可正常编译"]
))
p6.tasks.append(Task(
    "electron-builder 打包", "配置 Windows 打包，生成 exe + 压缩包",
    4, ["工具链离线打包", "Phase 1-5 全部完成"],
    ["双击 exe 可运行", "包体 ≤ 500MB"]
))
p6.tasks.append(Task(
    "README 文档", "功能介绍 + 截图 + 使用教程 + 常见问题",
    3, ["electron-builder 打包"],
    ["包含下载地址", "包含快速开始教程", "包含 FAQ"]
))
p6.tasks.append(Task(
    "Gitee Release 发布", "上传到 Gitee Release，配置国内下载",
    2, ["README 文档"],
    ["国内下载速度 ≥ 1MB/s", "页面可正常访问"]
))
p6.tasks.append(Task(
    "百度网盘/蓝奏云备份", "备用下载渠道",
    1, ["Gitee Release 发布"],
    ["网盘链接可用", "蓝奏云链接可用"]
))
p6.tasks.append(Task(
    "全新机器测试", "在干净 Windows 10/11 上全流程测试",
    4, ["百度网盘/蓝奏云备份"],
    ["断网全流程正常", "无杀软误报", "无残留注册表"]
))
p6.tasks.append(Task(
    "Phase 6 验收测试", "下载→解压→使用完整流程",
    3, ["全新机器测试"],
    ["全部 10 项通过", "tag v1.0.0-release"]
))

# 输出
output = plan.markdown()
print(output)

# 写入文件
with open("/home/pi/.openclaw/workspace/esp32-ide/PLAN-GENERATED.md", "w") as f:
    f.write(output)

print(f"\n--- 计划已保存到 PLAN-GENERATED.md ---")
print(f"总工作量: {plan.total_effort()} 人时")
print(f"预计交付: {plan.estimate_delivery()}")
