import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

export enum ReadingGrade {
  PrimaryLow = 'primary_low',
  PrimaryHigh = 'primary_high',
  Middle = 'middle',
  Senior = 'senior',
  Adult = 'adult',
}

@Entity('bibliographic_record')
@Unique(['isbn'])
export class BibliographicRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  title!: string;

  @Column({ type: 'varchar', nullable: true })
  author!: string | null;

  @Column({ type: 'varchar', nullable: true })
  publisher!: string | null;

  @Column({ type: 'varchar', nullable: true })
  isbn!: string | null;

  @Column({ type: 'varchar', nullable: true })
  category!: string | null;

  @Column({ name: 'reading_grade', type: 'varchar', enum: ReadingGrade, nullable: true })
  readingGrade!: ReadingGrade | null;

  @Column({ type: 'text', array: true, nullable: true })
  subjects!: string[] | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}