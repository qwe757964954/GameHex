import com.alibaba.fastjson.serializer.DoubleSerializer;
import com.alibaba.fastjson.serializer.SerializeConfig;
import com.gzyouai.hummingbird.json.dict.Dict;
import com.gzyouai.hummingbird.json.excel.Eson;
import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;
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

    // eSon 的 floatValue/doubleValue 以有符号差值判整型，会把所有负小数截断。
    private static void restoreNegativeFractions(File book, File output) throws Exception {
        try (FileInputStream stream = new FileInputStream(book)) {
            Workbook workbook = WorkbookFactory.create(stream);
            for (int index = 0; index < workbook.getNumberOfSheets(); index++) {
                Sheet sheet = workbook.getSheetAt(index);
                Row title = sheet.getRow(0), fields = sheet.getRow(4), types = sheet.getRow(5);
                if (title == null || fields == null || types == null || title.getCell(0) == null) continue;
                String table = title.getCell(0).toString();
                if (!table.endsWith(".json")) continue;
                for (String side : new String[] { "client", "sever" }) {
                    File target = new File(new File(output, side), table);
                    if (!target.isFile()) continue;
                    JSONArray rows = JSON.parseArray(new String(Files.readAllBytes(target.toPath()), StandardCharsets.UTF_8));
                    boolean changed = false;
                    for (Row row : sheet) {
                        if (row.getRowNum() < 6 || row.getCell(0) == null) continue;
                        String key = fields.getCell(0).toString();
                        String id = row.getCell(0).toString().replaceFirst("\\.0$", "");
                        for (Cell cell : row) {
                            int column = cell.getColumnIndex();
                            Cell type = types.getCell(column), field = fields.getCell(column);
                            if (type == null || field == null || !(type.toString().equals("float") || type.toString().equals("double"))) continue;
                            double value;
                            try { value = Double.parseDouble(cell.toString()); }
                            catch (NumberFormatException ignored) { continue; }
                            if (!Double.isFinite(value) || value >= 0 || value == (long) value) continue;
                            for (int r = 0; r < rows.size(); r++) {
                                JSONObject entry = rows.getJSONObject(r);
                                Object exported = entry.get(field.toString());
                                if (!id.equals(String.valueOf(entry.get(key))) || !(exported instanceof Number)) continue;
                                double actual = ((Number) exported).doubleValue();
                                if (actual == value) continue;
                                if (actual != (long) value) throw new IllegalStateException(table + " " + id + " " + field + ": unexpected numeric mismatch");
                                entry.put(field.toString(), value);
                                changed = true;
                            }
                        }
                    }
                    if (changed) Files.write(target.toPath(), JSON.toJSONString(rows).getBytes(StandardCharsets.UTF_8));
                }
            }
        }
    }

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
                restoreNegativeFractions(book, output);
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
