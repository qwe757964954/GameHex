import com.alibaba.fastjson.serializer.DoubleSerializer;
import com.alibaba.fastjson.serializer.SerializeConfig;
import com.gzyouai.hummingbird.json.dict.Dict;
import com.gzyouai.hummingbird.json.excel.Eson;
import java.io.File;
import java.util.Arrays;
import java.util.Comparator;
import org.eclipse.swt.SWT;
import org.eclipse.swt.widgets.Display;
import org.eclipse.swt.widgets.Shell;
import org.eclipse.swt.widgets.Text;

/**
 * 老 eSon 只有 SWT 按钮入口；本类复用同一个 Eson.toJson API，提供可被脚本/CI 调用的入口。
 * 运行时仍使用随 eSon 附带的 POI/fastjson/SWT，不改其导表语义。
 */
public final class EsonCli {
    private EsonCli() {}

    public static void main(String[] args) throws Exception {
        if (args.length != 2) {
            System.err.println("Usage: EsonCli <excel-directory> <json-output-directory>");
            System.exit(2);
        }
        File input = new File(args[0]).getCanonicalFile();
        File output = new File(args[1]).getCanonicalFile();
        if (!input.exists()) throw new IllegalArgumentException("Excel input not found: " + input);
        if (!output.exists() && !output.mkdirs()) throw new IllegalStateException("Cannot create output: " + output);

        SerializeConfig.getGlobalInstance().put(Double.class, new DoubleSerializer("#.############"));
        System.setProperty("java.util.Arrays.useLegacyMergeSort", "true");
        Dict.init(input.isDirectory() ? input.getAbsolutePath() : input.getParentFile().getAbsolutePath());
        Dict.dict = false;

        File[] books = input.isFile() ? new File[] { input } : input.listFiles((dir, name) -> {
            String lower = name.toLowerCase();
            return !name.startsWith("~$") && (lower.endsWith(".xls") || lower.endsWith(".xlsx"));
        });
        if (books == null) books = new File[0];
        Arrays.sort(books, Comparator.comparing(File::getName));

        Display display = new Display();
        Shell shell = new Shell(display);
        Text log = new Text(shell, SWT.MULTI);
        int count = 0;
        try {
            Eson eson = new Eson();
            eson.setPrintText(log);
            eson.setFormat(false);
            eson.setOneLine(false);
            for (File book : books) {
                System.out.println("[eSon] " + book.getName());
                count += eson.toJson(book, null, "json", 3, output.getAbsolutePath(), "json");
            }
            System.out.print(log.getText());
            System.out.println("\n[eSon] exported json files: " + count);
        } finally {
            log.dispose();
            shell.dispose();
            display.dispose();
        }
    }
}
