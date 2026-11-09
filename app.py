"""Launch TerminalSight from the repository root."""

if __name__ == '__main__':
    from multiprocessing import freeze_support

    freeze_support()
    from backend.server import main

    main()
